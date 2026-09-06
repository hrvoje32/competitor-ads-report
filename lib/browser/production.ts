import { chromium } from "playwright";
import { captureWithBrowser } from "@/lib/browser/capture";
import type { CreativeBrowser } from "@/lib/browser/types";

export async function createProductionBrowser(): Promise<CreativeBrowser> {
  const endpoint = process.env.BROWSER_WS_ENDPOINT;
  if (!endpoint) throw new Error("Production browser capture is not configured. Set BROWSER_WS_ENDPOINT.");
  let browser;
  try {
    browser = await chromium.connect(endpoint, { timeout: 20_000 });
  } catch {
    throw new Error("Production browser capture could not connect to the configured provider.");
  }
  return {
    capture: request => captureWithBrowser(browser, request),
    close: () => browser.close(),
  };
}
