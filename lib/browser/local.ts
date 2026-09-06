import { chromium } from "playwright";
import { captureWithBrowser } from "@/lib/browser/capture";
import type { CreativeBrowser } from "@/lib/browser/types";

export async function createLocalBrowser(): Promise<CreativeBrowser> {
  const browser = await chromium.launch({ headless: true, timeout: 20_000 });
  return {
    capture: request => captureWithBrowser(browser, request),
    close: () => browser.close(),
  };
}
