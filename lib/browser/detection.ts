import type { Locator, Page } from "playwright";
import type { CreativeSource, SelectorDiagnostic } from "@/lib/browser/types";

export const selectors: Record<CreativeSource, string[]> = {
  GOOGLE: ["[data-testid*='creative']", "[class*='creative-preview']", "[class*='creativePreview']", "main article"],
  META: ["[data-testid*='ad_snapshot']", "[data-testid*='ad-creative']", "[class*='adCreative']", "main article"],
};

const containerSelectors = [
  "[data-testid*='ad-preview']", "[class*='ad-preview']", "[class*='adPreview']",
  "[class*='creative-container']", "[class*='creativeContainer']",
  "[role='article']",
];

type Candidate = { locator: Locator; area: number };

export async function detectCreative(page: Page, source: CreativeSource) {
  const diagnostics: SelectorDiagnostic[] = [];
  // Source-specific candidates always take priority over generic page media.
  for (const group of [selectors[source], ["img", "video", "canvas", "iframe"], containerSelectors]) {
    const candidates: Candidate[] = [];
    for (const selector of group) {
      const locator = page.locator(selector);
      const inspected = await locator.evaluateAll(elements => {
        const visibleCandidates: Array<{ index: number; width: number; height: number; accepted: boolean }> = [];
        elements.forEach((element, index) => {
          const rect = element.getBoundingClientRect();
          if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || rect.width <= 0 || rect.height <= 0) return;
          const excluded = element.closest("nav, header, footer, button, [role='navigation'], [role='banner'], [role='button'], [role='toolbar'], [aria-hidden='true']");
          const label = [element.getAttribute("alt"), element.getAttribute("aria-label"), element.getAttribute("class"), element.id].join(" ");
          const decoration = /avatar|logo|(?:^|[\s_-])(?:icon|spinner|badge|profile)(?:$|[\s_-])/i.test(label)
            || Boolean(element.closest("[data-testid*='logo'], [class*='logo'], [class*='avatar']"));
          const media = element.matches("img, video, canvas, iframe");
          const unloadedImage = element instanceof HTMLImageElement && (!element.complete || element.naturalWidth < 120 || element.naturalHeight < 60);
          const largeEnough = rect.width >= 120 && rect.height >= 90 && rect.width * rect.height >= 30_000;
          // A whole feed/page is not a precise creative crop, even when its class contains "creative".
          const bounded = media || (rect.height <= innerHeight * 1.5 && rect.width * rect.height <= innerWidth * innerHeight * 1.5);
          visibleCandidates.push({ index, width: Math.round(rect.width), height: Math.round(rect.height), accepted: !excluded && !decoration && !unloadedImage && largeEnough && bounded });
        });
        return { matches: elements.length, visibleCandidates };
      }).catch(() => null);
      if (!inspected) {
        diagnostics.push({ selector, matches: 0, visibleCandidates: [], inspectionFailed: true });
        continue;
      }
      // Bound log payloads on feeds with hundreds of elements; matching still considers every element.
      diagnostics.push({ selector, matches: inspected.matches, visibleCandidates: inspected.visibleCandidates.slice(0, 50) });
      for (const candidate of inspected.visibleCandidates.filter(item => item.accepted)) {
        candidates.push({ locator: locator.nth(candidate.index), area: candidate.width * candidate.height });
      }
    }
    candidates.sort((a, b) => b.area - a.area);
    if (candidates.length) return { candidates, diagnostics };
  }
  return { candidates: [] as Candidate[], diagnostics };
}

export async function fallbackClip(page: Page) {
  return page.evaluate(() => {
    // Keep the current viewport; only remove chrome anchored to an edge.
    let left = 0, top = 0, right = innerWidth, bottom = innerHeight;
    for (const element of document.querySelectorAll("header, nav, footer, [role='banner'], [role='navigation'], [role='toolbar']")) {
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const r = element.getBoundingClientRect();
      if (r.width >= innerWidth * 0.8 && r.height <= innerHeight * 0.25) {
        if (r.top <= 2 && r.bottom > 0) top = Math.max(top, r.bottom);
        if (r.bottom >= innerHeight - 2 && r.top < innerHeight) bottom = Math.min(bottom, r.top);
      }
      if (r.height >= innerHeight * 0.7 && r.width <= innerWidth * 0.25) {
        if (r.left <= 2 && r.right > 0) left = Math.max(left, r.right);
        if (r.right >= innerWidth - 2 && r.left < innerWidth) right = Math.min(right, r.left);
      }
    }
    if (right - left < 320 || bottom - top < 240) return undefined;
    return { x: Math.ceil(left + scrollX), y: Math.ceil(top + scrollY), width: Math.floor(right - left), height: Math.floor(bottom - top) };
  }).catch(() => undefined);
}
