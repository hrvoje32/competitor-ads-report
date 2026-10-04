import { normalizeGoogleDomain } from "@/lib/google-domain";

export type BrandAdFilters = {
  adIncludeKeywords?: string[];
  adExcludeKeywords?: string[];
  adAllowedDomains?: string[];
  adExcludedDomains?: string[];
  metaPages?: Array<{ pageId: string }>;
};
export type FilterableAd = {
  source: "GOOGLE" | "META";
  externalId?: string | null;
  headline?: string | null;
  body?: string | null;
  description?: string | null;
  landingPageUrl?: string | null;
  sourceUrl?: string | null;
  snapshotUrl?: string | null;
  rawData?: unknown;
  notes?: string | null;
};
export type BrandFilterDecision = { brandFilterStatus: "INCLUDED" | "EXCLUDED"; brandFilterReason: string };

export function normalizedWords(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
export function parseFilterLines(value: string, domains = false): string[] {
  return [...new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    .map(line => domains ? normalizeGoogleDomain(line)! : normalizedWords(line)).filter(Boolean))];
}
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function adMetadata(item: FilterableAd): Record<string, unknown> {
  let notes: Record<string, unknown> = {};
  try { notes = record(JSON.parse(item.notes || "{}")); } catch { /* free-form user notes aren't advertiser identity */ }
  return { ...notes, ...record(item.rawData) };
}
function strings(value: unknown): string[] {
  return typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(strings) : [];
}
function wordMatch(text: string, alias: string) {
  const words = normalizedWords(alias);
  return Boolean(words && ` ${normalizedWords(text)} `.includes(` ${words} `));
}
function domain(value: string) {
  try { return normalizeGoogleDomain(value); } catch { return null; }
}
function matchesDomain(host: string, allowed: string) { return host === allowed || host.endsWith(`.${allowed}`); }

export function filterBrandAd(item: FilterableAd, config: BrandAdFilters): BrandFilterDecision {
  const include = config.adIncludeKeywords ?? [], exclude = config.adExcludeKeywords ?? [];
  const allowed = (config.adAllowedDomains ?? []).map(domain).filter((d): d is string => Boolean(d));
  const excluded = (config.adExcludedDomains ?? []).map(domain).filter((d): d is string => Boolean(d));
  const result = (included: boolean, reason: string): BrandFilterDecision => ({
    brandFilterStatus: included ? "INCLUDED" : "EXCLUDED",
    brandFilterReason: `${included ? "Included" : "Excluded"}: ${reason}`,
  });
  const raw = adMetadata(item);
  const pageId = String(raw.pageId ?? raw.page_id ?? raw.advertiserId ?? "");
  const pages = config.metaPages?.map(page => page.pageId) ?? [];
  // Preserve configured Page ownership even with no optional keyword filters.
  if (item.source === "META" && pages.length && pageId && !pages.includes(pageId)) return result(false, "Meta Page ID does not match this brand");
  if (item.source === "META" && pages.length && item.externalId && !pageId) return result(false, "collected Meta ad has no verifiable Page ID");
  if (![...include, ...exclude, ...allowed, ...excluded].length) return result(true, "no brand filters configured");

  const strongText = [item.headline, item.body, item.description,
    ...["ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions"].flatMap(key => strings(raw[key]))].filter(Boolean).join("\n");
  const ownerText = ["advertiserName", "advertiser_disclosed_name", "advertiser_legal_name", "legalName", "pageName", "page_name", "fundedBy", "ad_funded_by", "topic", "advertiser_location", "campaignName", "campaign_name"]
    .flatMap(key => strings(raw[key])).join("\n");
  const landing = [item.landingPageUrl, ...["destination_url", "landingPageUrl", "displayUrl", "display_url"].flatMap(key => strings(raw[key]))]
    .filter((v): v is string => Boolean(v)).map(domain).filter((d): d is string => Boolean(d));
  const hosts = [...landing, ...[item.sourceUrl, item.snapshotUrl].filter((v): v is string => Boolean(v)).map(domain).filter((d): d is string => Boolean(d))];
  const blockedDomain = hosts.find(host => excluded.some(value => matchesDomain(host, value)));
  if (blockedDomain) return result(false, `matched excluded domain ${blockedDomain}`);
  const creativeExclusion = exclude.find(alias => wordMatch(strongText, alias));
  if (creativeExclusion) return result(false, `matched excluded alias "${creativeExclusion}" in creative text`);
  // A known destination outside an explicit allowlist wins over an agency-name match.
  if (allowed.length && landing.length && !landing.some(host => allowed.some(value => matchesDomain(host, value)))) return result(false, `landing domain ${landing[0]} is not allowed`);
  const matchedDomain = allowed.find(value => hosts.some(host => matchesDomain(host, value)));
  if (matchedDomain) return result(true, `matched allowed domain ${matchedDomain}`);
  const creativeMatch = include.find(alias => wordMatch(strongText, alias));
  if (creativeMatch) return result(true, `matched alias "${creativeMatch}" in creative text`);
  const ownerExclusion = exclude.find(alias => wordMatch(ownerText, alias));
  if (ownerExclusion) return result(false, `matched excluded alias "${ownerExclusion}" in advertiser metadata`);
  if (item.source === "META" && pageId && pages.includes(pageId)) return result(true, "matched saved Meta Page ID");
  const ownerMatch = include.find(alias => wordMatch(ownerText, alias));
  if (ownerMatch) return result(true, `matched alias "${ownerMatch}" in advertiser metadata`);
  if (include.length || allowed.length) return result(false, "no positive brand match in available metadata");
  return result(true, "no configured exclusions matched");
}

export function hasUsableScreenshot(item: { localImagePath?: string | null; captureStatus?: string }) {
  return Boolean(item.localImagePath && item.captureStatus !== "CAPTURE_FAILED" && item.captureStatus !== "CAPTURING");
}
export function eligibleAnalysisEvidence<T extends FilterableAd & { localImagePath?: string | null; captureStatus?: string; selectedForSlide?: boolean; selectedForAnalysisEvidence?: boolean }>(items: T[], brand: BrandAdFilters): T[] {
  return items.filter(item => filterBrandAd(item, brand).brandFilterStatus === "INCLUDED"
    && hasUsableScreenshot(item) && (item.selectedForSlide || item.selectedForAnalysisEvidence));
}
