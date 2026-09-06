import type { CreativeBrowser } from "@/lib/browser/types";

export async function createCreativeBrowser(): Promise<CreativeBrowser> {
  if (process.env.VERCEL || process.env.BROWSER_WS_ENDPOINT) {
    const { createProductionBrowser } = await import("@/lib/browser/production");
    return createProductionBrowser();
  }
  const { createLocalBrowser } = await import("@/lib/browser/local");
  return createLocalBrowser();
}
