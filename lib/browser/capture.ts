import type { Browser, BrowserContext, Page } from "playwright";
import sharp from "sharp";
import type { CaptureDiagnostics, CreativeCaptureRequest, CreativeCaptureResult } from "@/lib/browser/types";
import { detectCreative, fallbackClip } from "@/lib/browser/detection";
import { safeCaptureText, safeCaptureUrl } from "@/lib/browser/diagnostics";
import { assertPublicHttpUrl } from "@/lib/browser/security";

async function routeSafely(page: Page) {
  await page.route("**/*", async route => {
    const requestUrl = new URL(route.request().url());
    if (!["http:", "https:"].includes(requestUrl.protocol)) {
      await route.continue();
      return;
    }
    try {
      await assertPublicHttpUrl(requestUrl.toString());
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}

// Exported so browser fixture tests exercise exactly the production detector and fallback.
export async function captureLoadedPage(page: Page, request: CreativeCaptureRequest): Promise<CreativeCaptureResult> {
  const title = await page.title().catch(() => "");
  const visibleText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const blocked = /verify (?:that )?you are human|access denied|login required|unusual traffic|security verification/i.test(`${title} ${visibleText}`)
    || (visibleText.length < 2_000 && /\bcaptcha\b/i.test(`${title} ${visibleText}`));
  if (blocked) throw new Error("Creative capture blocked by the source platform.");

  // Only the separate, two-ad diagnostic command opts in. No automatic full-page captures.
  const diagnosticFullPage = request.diagnosticFullPage
    ? await page.screenshot({ type: "png", fullPage: true, timeout: 10_000 }).catch(() => undefined)
    : undefined;
  const detection = await detectCreative(page, request.source);
  const diagnostics: CaptureDiagnostics = {
    source: request.source,
    finalUrl: safeCaptureText(safeCaptureUrl(page.url()), request.url),
    title: safeCaptureText(title, request.url),
    selectors: detection.diagnostics,
  };
  let screenshot: Buffer | undefined;
  let method: CreativeCaptureResult["method"] = "CREATIVE";
  // Try the largest candidates first; disappearing/lazy elements must not prevent a page fallback.
  for (const candidate of detection.candidates.slice(0, 3)) {
    try {
      screenshot = await candidate.locator.screenshot({ type: "png", timeout: 5_000 });
      break;
    } catch { /* A screenshot of the page is still useful if an element became stale. */ }
  }
  if (!screenshot) {
    method = "PAGE_FALLBACK";
    diagnostics.reason = detection.candidates.length ? "Creative candidates could not be captured." : "No reliable creative candidate found.";
    console.warn("Creative capture using page fallback", JSON.stringify(diagnostics));
    // A failed element screenshot may have scrolled the page. Restore a predictable fallback.
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    const clip = await fallbackClip(page);
    try {
      screenshot = await page.screenshot({ type: "png", fullPage: false, ...(clip ? { clip } : {}), timeout: 10_000 });
    } catch {
      // If page layout changed between measurement and screenshot, retry without clipping.
      screenshot = await page.screenshot({ type: "png", fullPage: false, timeout: 10_000 });
    }
  }
  let image: Buffer;
  let contentType: CreativeCaptureResult["contentType"] = "image/webp";
  try {
    image = await sharp(screenshot)
      .flatten({ background: "#ffffff" })
      .trim({ background: "#ffffff", threshold: 8 })
      .resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84 }).toBuffer();
  } catch {
    // Optimization is optional: preserve the actual PNG if trim/encoding fails.
    image = screenshot;
    contentType = "image/png";
  }
  return { image, contentType, method, diagnostics, diagnosticFullPage };
}

export async function captureWithBrowser(browser: Browser, request: CreativeCaptureRequest) {
  let context: BrowserContext | undefined;
  try {
    await assertPublicHttpUrl(request.url);
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true, locale: "en-US" });
    const page = await context.newPage();
    await routeSafely(page);
    const response = await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (response && response.status() >= 400) throw new Error(`Creative navigation failed (HTTP ${response.status()}).`);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    return await captureLoadedPage(page, request);
  } catch (error) {
    throw new Error(safeCaptureText(error instanceof Error ? error.message : "Creative screenshot failed.", request.url));
  } finally {
    await context?.close().catch(() => undefined);
  }
}
