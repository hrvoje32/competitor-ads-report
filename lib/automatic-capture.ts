import { createCreativeBrowser } from "@/lib/browser";
import { assertPublicHttpUrl } from "@/lib/browser/security";
import type { CreativeSource } from "@/lib/browser/types";

export { assertPublicHttpUrl };

export async function capturePublicPage(rawUrl: string, source: CreativeSource = "GOOGLE") {
  const browser = await createCreativeBrowser();
  try {
    return await browser.capture({ source, url: rawUrl });
  } finally {
    await browser.close();
  }
}
