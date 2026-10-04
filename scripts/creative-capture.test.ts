import assert from "node:assert/strict";
import { mock } from "node:test";
import { chromium, type Browser } from "playwright";
import sharp from "sharp";
import { captureLoadedPage, captureWithBrowser } from "../lib/browser/capture";
import { detectCreative, fallbackClip } from "../lib/browser/detection";
import { safeCaptureText, safeCaptureUrl } from "../lib/browser/diagnostics";

// Synthetic HTML only. No ad URLs, collection APIs, database, or storage writes.
async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => route.abort());
  const page = await context.newPage();
  const warnings: unknown[][] = [];
  const logger = mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  const request = { source: "GOOGLE" as const, url: "https://example.com/ad?access_token=private-test-token" };
  const base = "<style>body{margin:0} .creative{background:#2747aa}</style>";
  try {
    await page.setContent(`${base}
      <nav><div data-testid="creative" style="width:1300px;height:500px"></div></nav>
      <div data-testid="creative" class="logo" style="width:1000px;height:500px"></div>
      <div data-testid="creative" class="creative" style="width:300px;height:250px"></div>
      <div data-testid="creative" class="creative" style="width:600px;height:400px"></div>
      <div data-testid="creative" style="display:none;width:900px;height:700px"></div>
      <div data-testid="creative" style="width:24px;height:24px"></div>
      <canvas width="1000" height="600"></canvas>`);
    const detected = await detectCreative(page, "GOOGLE");
    assert.equal(detected.diagnostics[0].matches, 6);
    assert.equal(detected.diagnostics[0].visibleCandidates.filter(c => c.accepted).length, 2);
    const largest = await detected.candidates[0].locator.boundingBox();
    assert.equal(largest?.width, 600, "Largest source-specific match wins over navigation, logos, and generic media");
    const creative = await captureLoadedPage(page, request);
    assert.equal(creative.method, "CREATIVE");
    assert.equal((await sharp(creative.image).metadata()).width, 600);
    assert.equal(creative.diagnosticFullPage, undefined, "Full-page diagnostics are opt-in");
    assert.equal(warnings.length, 0);

    await page.setContent(`${base}
      <div data-testid="ad_snapshot" class="creative" style="width:250px;height:200px"></div>
      <div data-testid="ad_snapshot" class="creative" style="width:500px;height:350px"></div>`);
    const meta = await captureLoadedPage(page, { ...request, source: "META" });
    assert.equal(meta.method, "CREATIVE");
    assert.equal((await sharp(meta.image).metadata()).width, 500);

    const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: "#7744cc" } }).png().toBuffer();
    await page.setContent(`${base}
      <img alt="Company logo" src="data:image/png;base64,${png.toString("base64")}">
      <button><canvas width="900" height="600"></canvas></button>
      <canvas width="500" height="300" style="background:#27aa47"></canvas>
      <iframe style="width:400px;height:250px" srcdoc="<p>Ad content</p>"></iframe>
      <img alt="Unloaded creative" src="data:image/png;base64,invalid">`);
    const media = await detectCreative(page, "META");
    assert.equal(await media.candidates[0].locator.evaluate(el => el.tagName), "CANVAS");
    assert.ok(media.diagnostics.some(d => d.selector === "iframe" && d.visibleCandidates.some(c => c.accepted)));
    assert.ok(media.diagnostics.find(d => d.selector === "img")?.visibleCandidates.every(c => !c.accepted));

    // Selector inspection can fail during a DOM transition; fallback must still work.
    const locator = page.locator("[data-testid*='creative']");
    const originalLocator = page.locator.bind(page);
    const failingInspection = mock.method(locator, "evaluateAll", async () => { throw new Error("DOM changed"); });
    const failingLocator = mock.method(page, "locator", (selector: string) => selector === "[data-testid*='creative']" ? locator : originalLocator(selector));
    assert.equal((await detectCreative(page, "GOOGLE")).diagnostics[0].inspectionFailed, true);
    failingInspection.mock.restore();
    failingLocator.mock.restore();

    await page.setContent(`<title>Ad private-test-token https://user:pass@example.com/?token=other-secret#secret</title>
      <style>body{margin:0;background:#bbccee}header{height:100px;background:#223344}nav{position:fixed;left:0;top:100px;width:180px;height:900px}main{min-height:1300px}</style>
      <header>Navigation</header><nav>Menu</nav><main><p>Ad content without recognized selectors</p></main>`);
    assert.deepEqual(await fallbackClip(page), { x: 180, y: 100, width: 1260, height: 900 });
    const fallback = await captureLoadedPage(page, { ...request, diagnosticFullPage: true });
    assert.equal(fallback.method, "PAGE_FALLBACK");
    assert.ok(fallback.image.length > 0);
    assert.equal((await sharp(fallback.image).metadata()).width, 1260);
    assert.ok(((await sharp(fallback.diagnosticFullPage).metadata()).height ?? 0) >= 1400);
    assert.ok(fallback.diagnostics.selectors.length > 4);
    const serialized = JSON.stringify(warnings);
    assert.ok(!serialized.includes("private-test-token"));
    assert.ok(!serialized.includes("other-secret"));
    assert.ok(!serialized.includes("user:pass"));

    // A diagnostic failure must not invalidate the evidence screenshot.
    const originalScreenshot = page.screenshot.bind(page);
    const diagnosticFailure = mock.method(page, "screenshot", async (options: Parameters<typeof page.screenshot>[0]) => {
      if (options?.fullPage) throw new Error("Diagnostic timeout");
      return originalScreenshot(options);
    });
    const withoutDiagnostic = await captureLoadedPage(page, { ...request, diagnosticFullPage: true });
    assert.equal(withoutDiagnostic.method, "PAGE_FALLBACK");
    assert.equal(withoutDiagnostic.diagnosticFullPage, undefined);
    diagnosticFailure.mock.restore();

    const processingFailure = mock.method(sharp.prototype, "trim", () => { throw new Error("Trim failed"); });
    const rawScreenshot = await captureLoadedPage(page, request);
    assert.equal(rawScreenshot.contentType, "image/png");
    assert.equal((await sharp(rawScreenshot.image).metadata()).format, "png");
    processingFailure.mock.restore();

    // A stale clip retries the viewport, while an actual screenshot failure remains a hard failure.
    const clipFailure = mock.method(page, "screenshot", async (options: Parameters<typeof page.screenshot>[0]) => {
      if (options?.clip) throw new Error("Clip outside viewport");
      return originalScreenshot(options);
    });
    assert.equal((await captureLoadedPage(page, request)).method, "PAGE_FALLBACK");
    clipFailure.mock.restore();
    const screenshotFailure = mock.method(page, "screenshot", async () => { throw new Error("Screenshot unavailable"); });
    await assert.rejects(captureLoadedPage(page, request), /Screenshot unavailable/);
    screenshotFailure.mock.restore();

    await page.setContent("<h1>Verify you are human</h1>");
    await assert.rejects(captureLoadedPage(page, request), /blocked by the source platform/);
    await page.setContent("<h1>This content isn't available right now</h1><p>The ad may have been deleted.</p>");
    await assert.rejects(captureLoadedPage(page, { ...request, source: "META" }), /ad is unavailable/);
    await page.setContent("<body style='margin:0;background:white'></body>");
    await assert.rejects(captureLoadedPage(page, request), /did not render an identifiable ad page/, "An empty successful response is not ad evidence");
    await page.setContent("<title>Log in to Facebook</title><p>Enter your email and password</p>");
    await assert.rejects(captureLoadedPage(page, { ...request, source: "META" }), /blocked by the source platform/);

    assert.equal(safeCaptureUrl("https://name:password@example.com/ad?id=42&token=secret#fragment"), "https://example.com/ad");
    assert.ok(!safeCaptureText("Navigation to https://example.com/?secret=sensitive failed").includes("sensitive"));
    assert.ok(!safeCaptureText("Bearer confidential").includes("confidential"));

    // No network navigation: a literal public IP passes URL validation and a fake page throws.
    const failingBrowser = {
      newContext: async () => ({
        newPage: async () => ({ route: async () => {}, goto: async () => { throw new Error("Navigation failed https://8.8.8.8/?token=private-test-token"); } }),
        close: async () => { throw new Error("Cleanup failure must not replace navigation failure"); },
      }),
    } as unknown as Browser;
    await assert.rejects(captureWithBrowser(failingBrowser, { ...request, url: "https://8.8.8.8/?token=private-test-token" }), error => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes("Navigation failed"));
      assert.ok(!error.message.includes("private-test-token"));
      return true;
    });

    // Exercise both storage entry points with a mocked Supabase transport, not production storage.
    process.env.SUPABASE_URL = "https://storage.example.com";
    process.env.SUPABASE_SECRET_KEY = "test-storage-key";
    const { storeProviderImage } = await import("../lib/ad-media");
    const { saveEvidenceBufferDetails } = await import("../lib/uploads");
    let failStorage = false;
    const transport = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.hostname, "storage.example.com");
      assert.ok(url.pathname.endsWith(".png"));
      assert.equal(new Headers(init?.headers).get("content-type"), "image/png");
      return failStorage
        ? Response.json({ statusCode: "500", error: "StorageError", message: "Simulated storage failure" }, { status: 500 })
        : Response.json({ Key: url.pathname, Id: "test-object" });
    });
    try {
      const stored = await storeProviderImage(rawScreenshot.image, { id: "report" }, "brand", "GOOGLE", "ad", rawScreenshot.contentType);
      assert.ok(stored.path.endsWith(".png"));
      const manual = await saveEvidenceBufferDetails(rawScreenshot.image, { id: "report" }, "brand", "meta", rawScreenshot.contentType);
      assert.ok(manual.path.endsWith(".png"));
      failStorage = true;
      await assert.rejects(storeProviderImage(rawScreenshot.image, { id: "report" }, "brand", "META", "ad", "image/png"), /Storage upload failed: Simulated storage failure/);
    } finally {
      transport.mock.restore();
    }
    console.log("Creative capture fixture checks passed (no live ads captured).");
  } finally {
    logger.mock.restore();
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
