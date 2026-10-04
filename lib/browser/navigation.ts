import type { Page } from "playwright";
import type { CreativeCaptureRequest } from "@/lib/browser/types";
import { safeCaptureUrl } from "@/lib/browser/diagnostics";

function metaSnapshotId(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com"].includes(url.hostname)
      || !/^\/ads\/archive\/render_ad\/?$/.test(url.pathname)) return;
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? id : undefined;
  } catch { return; }
}

// Persisted/UI links stay token-free. Restore authentication only for this
// trusted Meta renderer, using a fresh canonical URL with no supplied redirects.
export function metaSnapshotCaptureUrl(raw: string, token: string | undefined): string {
  const id = metaSnapshotId(raw);
  if (!id || !token) return raw;
  const url = new URL("https://www.facebook.com/ads/archive/render_ad/");
  url.searchParams.set("id", id);
  url.searchParams.set("access_token", token);
  return url.toString();
}

// A token-bearing navigation must not leak into subresource requests/referrers.
// Used by the existing network safety route.
export function captureRequestPrivacy(raw: string, headers: Record<string, string>, token: string | undefined) {
  const url = new URL(raw);
  const containsToken = Boolean(token && (raw.includes(token) || raw.includes(encodeURIComponent(token))));
  const block = containsToken && !metaSnapshotId(raw);
  const safeHeaders = { ...headers };
  for (const name of Object.keys(safeHeaders)) {
    if (name.toLowerCase() === "referer" && (/access_token/i.test(safeHeaders[name])
      || (token && (safeHeaders[name].includes(token) || safeHeaders[name].includes(encodeURIComponent(token)))))) {
      delete safeHeaders[name];
    }
  }
  // Never forward an access_token query to an unrelated destination.
  return { block: block || (url.searchParams.has("access_token") && !metaSnapshotId(raw)), headers: safeHeaders };
}

export function tokenFreeMetaRedirect(location: string, responseUrl: string, token: string | undefined) {
  const url = new URL(location, responseUrl);
  url.searchParams.delete("access_token");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || (token && (url.toString().includes(token) || url.toString().includes(encodeURIComponent(token))))) {
    throw new Error("Meta snapshot returned an unsafe redirect.");
  }
  return url.toString();
}

// API snapshot links use the archive renderer. A public, token-free route exists
// for the same Library ID; never substitute a Page ID or a different ad.
export function metaLibraryFallbackUrl(raw: string): string | undefined {
  const id = metaSnapshotId(raw);
  if (!id) return;
  const fallback = new URL("https://www.facebook.com/ads/library/");
  fallback.searchParams.set("id", id);
  return fallback.toString();
}

export async function navigateCreativePage(page: Page, request: CreativeCaptureRequest) {
  const options = { waitUntil: "domcontentloaded" as const, timeout: 30_000 };
  const navigationUrl = request.source === "META"
    ? metaSnapshotCaptureUrl(request.url, process.env.META_ACCESS_TOKEN) : request.url;
  const response = await page.goto(navigationUrl, options);
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
