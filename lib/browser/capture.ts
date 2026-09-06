import type { Browser, Page } from "playwright";
import sharp from "sharp";
import type { CreativeCaptureRequest } from "@/lib/browser/types";
import { assertPublicHttpUrl } from "@/lib/browser/security";

const selectors: Record<CreativeCaptureRequest["source"], string[]> = {
  GOOGLE: ["[data-testid*='creative']", "[class*='creative-preview']", "[class*='creativePreview']", "main article"],
  META: ["[data-testid*='ad_snapshot']", "[data-testid*='ad-creative']", "[class*='adCreative']", "main article"],
};

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

async function processedScreenshot(page: Page, source: CreativeCaptureRequest["source"]) {
  let screenshot: Buffer | undefined;
  for (const selector of selectors[source]) {
    const locator = page.locator(selector);
    if (await locator.count() === 1 && await locator.isVisible()) {
      screenshot = await locator.screenshot({ type: "png", timeout: 10_000 });
      break;
    }
  }
  screenshot ??= await page.screenshot({ type: "png", fullPage: false, timeout: 10_000 });
  return sharp(screenshot)
    .flatten({ background: "#ffffff" })
    .trim({ background: "#ffffff", threshold: 8 })
    .resize({ width: 1600, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toBuffer();
}

export async function captureWithBrowser(browser: Browser, request: CreativeCaptureRequest) {
  await assertPublicHttpUrl(request.url);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: true, locale: "en-US" });
  try {
    const page = await context.newPage();
    await routeSafely(page);
    await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    const visibleText = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).toLowerCase();
    if (["captcha", "verify you are human", "access denied", "login required"].some(marker => visibleText.includes(marker))) {
      throw new Error("Creative capture blocked by the source platform.");
    }
    const output = await processedScreenshot(page, request.source);
    if (output.length < 1_000) throw new Error("Creative capture returned an empty image.");
    return output;
  } finally {
    await context.close();
  }
}
