import assert from "node:assert/strict";
import { mock } from "node:test";
import sharp from "sharp";
import type { AdEvidence, AdMedia, AdProviderRun, Report } from "@prisma/client";

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some(part => matches(row, part));
    if (value instanceof Date) return row[key] instanceof Date && (row[key] as Date).getTime() === value.getTime();
    if (value && typeof value === "object") {
      const op = value as Row;
      if ("in" in op) return (op.in as unknown[]).includes(row[key]);
      if ("notIn" in op) return !(op.notIn as unknown[]).includes(row[key]);
      if ("lt" in op) return row[key] instanceof Date && (row[key] as Date) < (op.lt as Date);
      return matches((row[key] ?? {}) as Row, op);
    }
    return row[key] === value;
  });
}

async function main() {
  // Only dummy credentials; every HTTP call is intercepted, including Supabase.
  process.env.SUPABASE_URL = "https://storage.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key-not-a-secret";
  const evidence: AdEvidence[] = [], media: AdMedia[] = [];
  const run = { id: "run", brandReportId: "br", source: "GOOGLE", provider: "APIFY", status: "PROCESSING", datasetId: "dataset", processingStartedAt: null } as AdProviderRun;
  let exportReport: unknown;
  const rowsFor = (table: string): Row[] => table === "adProviderRun" ? [run as unknown as Row] : table === "adEvidence" ? evidence as unknown as Row[] : media.map(item => Object.assign(item, { adEvidence: evidence.find(row => row.id === item.adEvidenceId) })) as unknown as Row[];
  const delegate = (table: string) => ({
    findMany: async ({ where = {}, take }: { where?: Row; take?: number } = {}) => rowsFor(table).filter(row => matches(row, where)).slice(0, take),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => { const found = rowsFor(table).filter(row => matches(row, where)); found.forEach(row => Object.assign(row, data)); return { count: found.length }; },
    update: async ({ where, data }: { where: Row; data: Row }) => { const row = rowsFor(table).find(row => matches(row, where)); assert.ok(row); Object.assign(row, data); return row; },
  });
  Object.assign(globalThis, { prisma: { adProviderRun: delegate("adProviderRun"), adEvidence: delegate("adEvidence"), adMedia: delegate("adMedia"), report: { findUnique: async () => exportReport }, $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops) } });
  const { processApifyMedia } = await import("../lib/apify-media");
  const { rankedApifyCandidates } = await import("../lib/apify-selection");
  const { eligibleAnalysisEvidence, filterBrandAd } = await import("../lib/brand-ad-filter");
  const { normalizeGoogleApifyAd, googleApifyProvider } = await import("../lib/ad-providers/google/apify");
  const { normalizeMetaApifyAd, metaApifyProvider } = await import("../lib/ad-providers/meta/apify");
  const { downloadAndProcessImage } = await import("../lib/ad-media");
  const { chromium } = await import("playwright");
  for (const method of ["connect", "connectOverCDP", "launch"] as const) mock.method(chromium, method, () => { throw new Error("Apify media must never open Browserless"); });
  const fixture = await sharp({ create: { width: 600, height: 400, channels: 3, background: "#123456" } }).png().toBuffer();
  let downloads: string[] = [], uploads: string[] = [], failStorage = false;
  mock.method(globalThis, "fetch", async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "8.8.8.8") {
      downloads.push(url.pathname);
      if (url.pathname.includes("bad")) return new Response("unavailable", { status: 404 });
      if (url.pathname.includes("html")) return new Response("<html>not media</html>", { headers: { "content-type": "text/html" } });
      if (url.pathname.includes("corrupt")) return new Response("bad bytes", { headers: { "content-type": "image/png" } });
      const index = Number(url.pathname.match(/(\d+)$/)?.[1] ?? 0);
      const creative = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: (index * 29) % 256, g: (index * 53) % 256, b: (index * 97) % 256 } } }).png().toBuffer();
      return new Response(new Uint8Array(creative), { headers: { "content-type": "image/png" } });
    }
    assert.equal(url.hostname, "storage.example.test", "No unmocked outbound requests");
    if (options?.method === "POST") {
      uploads.push(url.pathname);
      if (failStorage) return Response.json({ message: "Upload unavailable", statusCode: "403", error: "Forbidden" }, { status: 403 });
      return Response.json({ Key: url.pathname });
    }
    return new Response(new Uint8Array(fixture), { headers: { "content-type": "image/png" } });
  });
  const request = { brandName: "Peugeot", googleDomain: "peugeot.hr", metaPageIds: ["123"], countryCode: "HR", startDate: "2026-09-01", endDate: "2026-09-30", maxResults: 500 };
  assert.equal(googleApifyProvider(request).input.maxAds, 20);
  assert.equal(metaApifyProvider(request).input.maxResults, 20);
  assert.deepEqual(normalizeGoogleApifyAd({ creative_id: "g", image_url: "https://8.8.8.8/image", preview_url: "https://8.8.8.8/preview" })?.imageUrls, ["https://8.8.8.8/image", "https://8.8.8.8/preview"]);
  const meta = normalizeMetaApifyAd({ libraryId: "m", imageUrls: ["https://8.8.8.8/main"], cards: [{ imageUrl: "https://8.8.8.8/card" }], snapshot: { images: [{ original_image_url: "https://8.8.8.8/snapshot" }], videos: [{ video_preview_image_url: "https://8.8.8.8/thumb" }] } });
  assert.equal(meta?.imageUrls.length, 3); assert.deepEqual(meta?.videoThumbnailUrls, ["https://8.8.8.8/thumb"]);
  await assert.rejects(downloadAndProcessImage("https://8.8.8.8/html"), /content type/);
  await assert.rejects(downloadAndProcessImage("https://8.8.8.8/corrupt"), /not a valid/);
  const brand = { adIncludeKeywords: ["Peugeot"], adExcludeKeywords: ["Citroën", "Fiat", "Mercedes-Benz"], adAllowedDomains: ["peugeot.hr"], metaPages: [{ pageId: "123" }] };
  const apifyAd = { source: "GOOGLE" as const, rawData: { collectionProvider: "APIFY" } };
  assert.equal(filterBrandAd({ ...apifyAd, headline: "Explore a new adventure" }, brand).brandFilterStatus, "INCLUDED");
  assert.equal(filterBrandAd({ ...apifyAd, landingPageUrl: "https://citroen.hr/offers" }, brand).brandFilterStatus, "EXCLUDED");
  assert.equal(filterBrandAd({ ...apifyAd, source: "META", rawData: { collectionProvider: "APIFY", pageId: "999" } }, brand).brandFilterStatus, "EXCLUDED");
  assert.equal(filterBrandAd({ ...apifyAd, source: "META" }, brand).brandFilterStatus, "INCLUDED", "Missing metadata is not a conflict");
  assert.equal(filterBrandAd(apifyAd, {}).brandFilterStatus, "INCLUDED");
  assert.equal(filterBrandAd({ ...apifyAd, landingPageUrl: "https://peugeot.hr", rawData: { collectionProvider: "APIFY", advertiserName: "Peugeot Fiat dealer" } }, brand).brandFilterStatus, "INCLUDED", "Known brand destination outweighs multi-brand agency metadata");
  const br = { id: "br", brandId: "brand", brand, report: { id: "report" } as Report };
  function seed(count: number, badFirst = false) {
    evidence.length = media.length = 0; downloads = []; uploads = []; run.processingStartedAt = null;
    for (let n = 0; n < count; n++) {
      const id = `ad-${String(n).padStart(2, "0")}`, url = `https://8.8.8.8/${badFirst && n === 0 ? "bad" : "image"}-${n}`;
      evidence.push({ id, brandReportId: "br", source: "GOOGLE", externalId: id, headline: `Offer ${n}`, localImagePath: null, captureStatus: "PENDING", brandFilterStatus: "INCLUDED", rawData: { collectionProvider: "APIFY", apifyDatasetId: "dataset", imageUrls: [url] }, selectedForSlide: false, selectedForAnalysisEvidence: false, sortOrder: n, cropX: null, cropY: null, cropWidth: null, cropHeight: null } as unknown as AdEvidence);
      media.push({ id: `media-${n}`, adEvidenceId: id, sourceUrl: url, status: "PENDING", sortOrder: 0 } as AdMedia);
    }
  }
  seed(20, true);
  for (let n = 0; n < 8; n++) await processApifyMedia(br, run);
  assert.equal(uploads.length, 5); assert.equal(downloads.length, 6, "Failed first candidate must advance without downloading the other 14");
  assert.equal(evidence.filter(item => item.selectedForSlide).length, 5);
  assert.equal(evidence[0].captureStatus, "CAPTURE_FAILED");
  assert.ok(evidence[1].localImagePath?.startsWith("reports/report/brand/google/"));
  assert.equal(evidence[1].captureMethod, "APIFY_MEDIA");
  const retained = evidence[1].localImagePath;
  for (let n = 0; n < 3; n++) await processApifyMedia(br, run);
  assert.equal(downloads.length, 6, "Regeneration must reuse stored files");
  assert.equal(evidence[1].localImagePath, retained); assert.equal(evidence.length, 20);
  for (const method of ["connect", "connectOverCDP", "launch"] as const) assert.equal((chromium[method] as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
  const first = evidence[1];
  assert.equal(rankedApifyCandidates([first, { ...first, id: "same-id" }, { ...first, id: "same-media", externalId: "another" }, { ...first, id: "same-url", externalId: "third", rawData: {}, sourceUrl: "https://example.com/ad" }, { ...first, id: "same-url-2", externalId: "fourth", rawData: {}, sourceUrl: "https://example.com/ad?utm_source=tracking" }]).length, 2);
  assert.equal(rankedApifyCandidates([{ ...first, headline: "Discover our new electric vehicle today" }, { ...first, id: "variant", externalId: "variant", rawData: {}, headline: "Discover our new electric vehicle today!" }]).length, 1);
  seed(3);
  await Promise.all([processApifyMedia(br, run), processApifyMedia(br, run)]);
  assert.equal(downloads.length, 1, "Source lease prevents overlapping downloads");
  for (let n = 0; n < 3; n++) await processApifyMedia(br, run);
  assert.equal(uploads.length, 3); assert.equal(eligibleAnalysisEvidence(evidence, brand).length, 3);
  seed(2); failStorage = true; await processApifyMedia(br, run); failStorage = false; await processApifyMedia(br, run);
  assert.equal(evidence[0].localImagePath, null); assert.equal(evidence[1].captureStatus, "READY", "Storage failure advances to next candidate");
  seed(24);
  media.forEach(item => { item.sourceUrl = `https://8.8.8.8/bad-${item.id}`; });
  for (let n = 0; n < 24; n++) await processApifyMedia(br, run);
  assert.equal(downloads.length, 20, "Legacy oversized pools still have a bounded twenty-candidate media budget");
  assert.equal(evidence.length, 24, "Budget never deletes retained ads");
  seed(3);
  media[1].sourceUrl = "https://8.8.8.8/another-cdn-copy-0";
  for (let n = 0; n < 3; n++) await processApifyMedia(br, run);
  assert.equal(uploads.length, 2, "Identical downloaded image bytes are not stored twice, even with different URLs");

  // Exercise the real PowerPoint route with legacy eight-selected records plus
  // unselected missing-media records. All storage reads stay mocked.
  seed(8);
  evidence.forEach(item => { item.localImagePath = `reports/${item.id}.webp`; item.captureStatus = "READY"; item.selectedForSlide = true; });
  const google = structuredClone(evidence);
  const metaEvidence = google.slice(0, 3).map(item => ({ ...item, id: `meta-${item.id}`, source: "META" as const }));
  const unselected = { ...google[0], id: "unselected", localImagePath: null, selectedForSlide: false };
  assert.equal(eligibleAnalysisEvidence([...google, ...metaEvidence, unselected], brand).length, 8, "Analysis accepts five Google plus three Meta");
  exportReport = { id: "report", title: "Fixture report", month: 9, year: 2026, language: "EN", brandReports: [{ brand: { ...brand, name: "Peugeot", logoPath: null }, automationStatus: "READY", analysisNeedsRegeneration: false, analysisJson: null, analysisEditedJson: null, adEvidence: [...google, ...metaEvidence, unselected] }] };
  const { GET } = await import("../app/api/reports/[id]/export/route");
  const { NextRequest } = await import("next/server");
  const response = await GET(new NextRequest("https://example.test/api/reports/report/export"), { params: Promise.resolve({ id: "report" }) });
  assert.equal(response.status, 200);
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  const slides = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 3);
  assert.equal(((await zip.file("ppt/slides/slide1.xml")!.async("string")).match(/<p:pic>/g) ?? []).length, 5);
  assert.equal(((await zip.file("ppt/slides/slide2.xml")!.async("string")).match(/<p:pic>/g) ?? []).length, 3);
  assert.equal(google.length, 8, "Legacy records remain intact");
  console.log("Apify normalization, real image validation/Supabase upload, zero browser use, ranking, five-creative limit, retries, concurrency, reuse, safety, partial analysis and three-slide PPTX tests passed.");
}
main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
