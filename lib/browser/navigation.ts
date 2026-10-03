import type { Page } from "playwright";
import type { CreativeCaptureRequest } from "@/lib/browser/types";
import { safeCaptureUrl } from "@/lib/browser/diagnostics";

// API snapshot links use the archive renderer. A public, token-free route exists
// for the same Library ID; never substitute a Page ID or a different ad.
export function metaLibraryFallbackUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"].includes(url.hostname)) return;
    if (!/^\/ads\/archive\/render_ad\/?$/.test(url.pathname)) return;
    const id = url.searchParams.get("id");
    if (!id || !/^\d+$/.test(id)) return;
    const fallback = new URL("https://www.facebook.com/ads/library/");
    fallback.searchParams.set("id", id);
    return fallback.toString();
  } catch { return; }
}

export async function navigateCreativePage(page: Page, request: CreativeCaptureRequest) {
  const options = { waitUntil: "domcontentloaded" as const, timeout: 30_000 };
  const response = await page.goto(request.url, options);
  const status = response?.status();
  if (status === undefined || status < 400) return;
  const fallback = request.source === "META" && [404, 410].includes(status)
    ? metaLibraryFallbackUrl(request.url) : undefined;
  if (!fallback) throw new Error(`Creative navigation failed (HTTP ${status}).`);

  console.warn("Meta snapshot unavailable; trying the same ad in the public Ad Library", JSON.stringify({
    source: request.source, status, snapshotUrl: safeCaptureUrl(request.url), fallbackUrl: safeCaptureUrl(fallback),
  }));
  // Exactly one alternate URL for this ad, with no access token or unrelated query parameters.
  const retry = await page.goto(fallback, options);
  const retryStatus = retry?.status();
  if (retryStatus !== undefined && retryStatus >= 400) {
    throw new Error(`Meta snapshot returned HTTP ${status}; the public Ad Library page also failed (HTTP ${retryStatus}).`);
  }
}
