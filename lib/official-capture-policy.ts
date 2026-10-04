import { adMetadata, hasUsableScreenshot, normalizedWords, type FilterableAd } from "@/lib/brand-ad-filter";

export const MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE = 5;
export const MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE = 8;
export type CaptureCandidate = FilterableAd & {
  id: string; externalId?: string | null; format?: string | null;
  firstShown?: Date | null; lastShown?: Date | null; localImagePath?: string | null;
  captureStatus?: string; officialCaptureAttemptedAt?: Date | null;
  brandFilterStatus?: string;
};
export function creativeUrlKey(raw?: string | null) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.username = ""; url.password = "";
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|access_token$|token$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}
function message(item: CaptureCandidate) { return normalizedWords([item.headline, item.body, item.description].filter(Boolean).join(" ")); }
function campaign(item: CaptureCandidate) {
  const raw = adMetadata(item);
  return String(raw.campaignId ?? raw.campaign_id ?? raw.campaignName ?? raw.campaign_name ?? raw.groupId ?? "");
}
function features(item: CaptureCandidate) {
  return [item.format && `format:${normalizedWords(item.format)}`, message(item) && `text:${message(item)}`,
    item.landingPageUrl && `landing:${creativeUrlKey(item.landingPageUrl)}`, campaign(item) && `campaign:${campaign(item)}`].filter((v): v is string => Boolean(v));
}
function recent(item: CaptureCandidate) { return (item.lastShown || item.firstShown)?.getTime() || 0; }

// Never mutate/delete collected records. Prefer a stored member of a duplicate
// group so regeneration cannot choose its uncaptured twin and reopen the ad.
export function rankCaptureCandidates<T extends CaptureCandidate>(items: T[]): T[] {
  const sorted = items.filter(item => item.brandFilterStatus !== "EXCLUDED")
    .sort((a, b) => Number(hasUsableScreenshot(b)) - Number(hasUsableScreenshot(a)) || recent(b) - recent(a) || a.id.localeCompare(b.id));
  const parents = sorted.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const keys = new Map<string, number>();
  sorted.forEach((item, index) => {
    const copy = message(item);
    const itemKeys = [item.externalId && `id:${item.externalId}`,
      ...[item.sourceUrl, item.snapshotUrl].map(url => creativeUrlKey(url)).filter(Boolean).map(url => `url:${url}`),
      copy.split(" ").length >= 3 && `copy:${copy}|${normalizedWords(item.format || "")}|${creativeUrlKey(item.landingPageUrl)}`]
      .filter((key): key is string => Boolean(key)).map(key => `${item.source}:${key}`);
    for (const key of itemKeys) {
      const owner = keys.get(key);
      if (owner !== undefined) {
        const left = find(index), right = find(owner);
        parents[Math.max(left, right)] = Math.min(left, right);
      } else keys.set(key, index);
    }
  });
  const unique = sorted.filter((_, index) => find(index) === index);
  const ranked: T[] = [], seen = new Set<string>();
  while (unique.length) {
    unique.sort((a, b) => {
      const score = (item: T) => (hasUsableScreenshot(item) ? 100 : 0) + features(item).filter(key => !seen.has(key)).length * 10;
      return score(b) - score(a) || recent(b) - recent(a) || a.id.localeCompare(b.id);
    });
    const next = unique.shift()!;
    ranked.push(next); features(next).forEach(key => seen.add(key));
  }
  return ranked;
}
export function captureBudgetOpen(attempts: number, stored: number) {
  return attempts < MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE && stored < MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE;
}
export function nextCaptureCandidate<T extends CaptureCandidate>(items: T[], attempts: number, stored: number) {
  if (!captureBudgetOpen(attempts, stored)) return undefined;
  return rankCaptureCandidates(items).filter(item => hasUsableScreenshot(item) || item.snapshotUrl || item.sourceUrl)
    .slice(0, MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE)
    .find(item => !item.localImagePath && !item.officialCaptureAttemptedAt && item.captureStatus !== "CAPTURING");
}
