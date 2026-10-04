import assert from "node:assert/strict";
import { eligibleAnalysisEvidence, filterBrandAd, normalizedWords, parseFilterLines } from "../lib/brand-ad-filter";
import { creativeUrlKey, nextCaptureCandidate, rankCaptureCandidates, type CaptureCandidate } from "../lib/official-capture-policy";

const brand = { adIncludeKeywords: ["Peugeot", "peugeot.hr"], adExcludeKeywords: ["Citroën", "Fiat", "Mercedes-Benz"], adAllowedDomains: ["peugeot.hr", "peugeot.com"], adExcludedDomains: ["fiat.hr"], metaPages: [{ pageId: "123" }] };
const ad = { source: "GOOGLE" as const, headline: "Peugeot 3008 new offer" };
assert.equal(filterBrandAd(ad, brand).brandFilterStatus, "INCLUDED");
for (const headline of ["Citroën C3 new offer", "Citroen C3 new offer", "Fiat new offer", "Mercedes Benz offer", "Peugeot and Fiat offers"]) {
  assert.equal(filterBrandAd({ ...ad, headline }, brand).brandFilterStatus, "EXCLUDED");
}
assert.equal(normalizedWords("  CITROËN — C3  "), "citroen c3");
assert.deepEqual(parseFilterLines("Citroën\nCitroen\n  Peugeot  "), ["citroen", "peugeot"]);
assert.deepEqual(parseFilterLines("https://www.peugeot.hr/path\nPEUGEOT.HR", true), ["peugeot.hr"]);
assert.throws(() => parseFilterLines("not a domain", true));
assert.equal(filterBrandAd({ ...ad, headline: null, landingPageUrl: "https://offers.peugeot.hr/new" }, brand).brandFilterStatus, "INCLUDED");
assert.equal(filterBrandAd({ ...ad, headline: null, sourceUrl: "https://peugeot.com/ad" }, brand).brandFilterStatus, "INCLUDED");
for (const url of ["https://fiat.hr", "https://peugeot.hr.attacker.test", "https://fakepeugeot.hr"]) {
  assert.equal(filterBrandAd({ ...ad, landingPageUrl: url }, brand).brandFilterStatus, "EXCLUDED");
}
assert.equal(filterBrandAd({ ...ad, headline: "Peugeoty" }, brand).brandFilterStatus, "EXCLUDED", "No arbitrary substring matching");
assert.equal(filterBrandAd({ source: "GOOGLE", rawData: { advertiserName: "mmb media agentur d.o.o." } }, brand).brandFilterStatus, "EXCLUDED", "Agency IDs/names don't establish marque ownership");
assert.equal(filterBrandAd({ source: "GOOGLE", rawData: { advertiser_legal_name: "Peugeot Hrvatska" } }, brand).brandFilterStatus, "INCLUDED");
assert.equal(filterBrandAd({ source: "GOOGLE", rawData: { advertiserName: "Peugeot Fiat dealer" } }, brand).brandFilterStatus, "EXCLUDED", "Exclusion beats weak advertiser inclusion");
assert.equal(filterBrandAd({ source: "GOOGLE", landingPageUrl: "https://peugeot.hr", rawData: { advertiserName: "Peugeot Fiat dealer" } }, brand).brandFilterStatus, "INCLUDED", "Strong destination beats weak agency metadata");
assert.equal(filterBrandAd({ source: "META", rawData: { page_id: "123" } }, brand).brandFilterStatus, "INCLUDED");
assert.equal(filterBrandAd({ source: "META", headline: "Peugeot", rawData: { page_id: "999" } }, brand).brandFilterStatus, "EXCLUDED");
assert.equal(filterBrandAd({ source: "META", headline: "Fiat", rawData: { page_id: "123" } }, brand).brandFilterStatus, "EXCLUDED");
assert.equal(filterBrandAd({ source: "GOOGLE", headline: "Fiat" }, {}).brandFilterStatus, "INCLUDED", "Empty config preserves existing behavior");

const candidate = (id: string, overrides: Partial<CaptureCandidate> = {}): CaptureCandidate => ({ id, source: "GOOGLE", externalId: id, sourceUrl: `https://ads.example/creative/${id}`, brandFilterStatus: "INCLUDED", ...overrides });
const unique = rankCaptureCandidates([
  candidate("one"), candidate("copy-id", { externalId: "one" }),
  candidate("copy-url", { sourceUrl: "https://ads.example/creative/one?utm_source=test" }),
  candidate("different"), candidate("excluded", { brandFilterStatus: "EXCLUDED" }),
]);
assert.equal(unique.length, 2);
assert.notEqual(creativeUrlKey("https://facebook.com/ads/library/?id=1"), creativeUrlKey("https://facebook.com/ads/library/?id=2"));
assert.equal(rankCaptureCandidates([candidate("a", { headline: "New Peugeot vehicle offer" }), candidate("b", { headline: "New Peugeot vehicle offer" })]).length, 1);
const ranked = rankCaptureCandidates([
  candidate("recent-image", { format: "image", lastShown: new Date("2026-09-30") }),
  candidate("older-image", { format: "image", lastShown: new Date("2026-09-29") }),
  candidate("video", { format: "video", lastShown: new Date("2026-09-20") }),
]);
assert.deepEqual(ranked.map(item => item.id), ["recent-image", "video", "older-image"]);
const saved = candidate("saved", { externalId: "one", localImagePath: "saved.webp", captureStatus: "READY" });
assert.equal(rankCaptureCandidates([candidate("duplicate", { externalId: "one" }), saved])[0].id, "saved");
assert.equal(nextCaptureCandidate([saved, candidate("duplicate", { externalId: "one" })], 0, 1), undefined);

const evidence = Array.from({ length: 8 }, (_, index) => ({ ...ad, id: String(index), source: index < 5 ? "GOOGLE" as const : "META" as const, localImagePath: "stored.webp", captureStatus: "READY", selectedForSlide: true }));
assert.equal(eligibleAnalysisEvidence(evidence, brand).length, 8, "Five Google plus three Meta are enough; exactly five per source isn't required");
const unfit = [
  { ...evidence[0], headline: "Fiat" }, { ...evidence[0], localImagePath: null },
  { ...evidence[0], selectedForSlide: false }, { ...evidence[0], captureStatus: "CAPTURE_FAILED" },
];
assert.equal(eligibleAnalysisEvidence(unfit, brand).length, 0);
console.log("Brand filter, accent/domain safety, deduplication, diversity, reuse, and analysis eligibility tests passed.");
