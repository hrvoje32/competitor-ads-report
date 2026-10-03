import { createCreativeBrowser } from "@/lib/browser";
import { assertPublicHttpUrl } from "@/lib/browser/security";
import type { CreativeSource } from "@/lib/browser/types";

export { assertPublicHttpUrl };

export async function capturePublicPage(rawUrl: string, source: CreativeSource = "GOOGLE", options: { diagnosticFullPage?: boolean } = {}) {
  const browser = await createCreativeBrowser();
  try {
    return await browser.capture({ source, url: rawUrl, ...options });
  } finally {
    // Cleanup must not replace a successful capture or its original error.
    await browser.close().catch(() => undefined);
  }
}
