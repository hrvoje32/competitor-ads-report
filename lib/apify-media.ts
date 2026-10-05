import type { AdProviderRun, Report } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { downloadAndProcessImage, storeProviderImage } from "@/lib/ad-media";
import { apifyError } from "@/lib/ad-providers/apify";
import { adMetadata, filterBrandAd, hasUsableScreenshot, record, type BrandAdFilters } from "@/lib/brand-ad-filter";
import { rankedApifyCandidates } from "@/lib/apify-selection";
import { MAX_MEDIA_URLS_PER_CREATIVE, MAX_REPORT_CREATIVES_PER_SOURCE } from "@/lib/ad-evidence-limits";

// Explicit I/O boundary for deterministic tests. No browser dependency: fallback
// capture remains an opt-in action after direct media is exhausted.
export const apifyMediaServices = { download: downloadAndProcessImage, store: storeProviderImage };

export async function processApifyMedia(brandReport: { id: string; brandId: string; brand: BrandAdFilters; report: Report }, run: AdProviderRun) {
  const lease = new Date();
  const claimed = await prisma.adProviderRun.updateMany({
    where: { id: run.id, status: "PROCESSING", OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } }] },
    data: { processingStartedAt: lease },
  });
  if (!claimed.count) return;
  const where = { brandReportId: brandReport.id, source: run.source };
  try {
    const all = await prisma.adEvidence.findMany({ where });
    const ranked = rankedApifyCandidates(all.map(item => ({ ...item, ...filterBrandAd(item, brandReport.brand) })), run.datasetId);
    const stored = ranked.filter(hasUsableScreenshot).slice(0, MAX_REPORT_CREATIVES_PER_SOURCE);
    const selectedIds = stored.map(item => item.id);
    const pending = ranked.filter(item => !item.localImagePath && item.captureStatus !== "CAPTURE_FAILED");
    // One creative per poll: at most three bounded downloads, comfortably below
    // Vercel's request budget. Failed creatives advance to the next ranked row.
    const candidate = stored.length < MAX_REPORT_CREATIVES_PER_SOURCE ? pending[0] : undefined;
    if (candidate) {
      const media = await prisma.adMedia.findMany({ where: { adEvidenceId: candidate.id }, orderBy: { sortOrder: "asc" }, take: MAX_MEDIA_URLS_PER_CREATIVE });
      let failure = "Apify supplied no usable image or video thumbnail. Upload evidence or use optional browser capture.";
      for (const asset of media) {
        if (asset.status === "FAILED" || asset.status === "DISCARDED") continue;
        // A prior interrupted invocation may have left DOWNLOADING behind. The
        // source lease protects this retry and prevents simultaneous downloads.
        await prisma.adMedia.update({ where: { id: asset.id }, data: { status: "DOWNLOADING", error: null } });
        try {
          const image = await apifyMediaServices.download(asset.sourceUrl);
          const digest = createHash("sha256").update(image).digest("hex");
          if (stored.some(item => adMetadata(item).apifyMediaDigest === digest)) {
            failure = "This image is already represented by another stored creative.";
            await prisma.adMedia.update({ where: { id: asset.id }, data: { status: "DISCARDED", error: failure } });
            continue;
          }
          const result = await apifyMediaServices.store(image, brandReport.report, brandReport.brandId, run.source, candidate.externalId || candidate.id);
          await prisma.$transaction([
            prisma.adMedia.update({ where: { id: asset.id }, data: { status: "STORED", storagePath: result.path, byteSize: result.byteSize, error: null } }),
            prisma.adEvidence.update({ where: { id: candidate.id }, data: { localImagePath: result.path, storedMediaBytes: result.byteSize, captureStatus: "READY", captureMethod: "APIFY_MEDIA", captureError: null, selectedForSlide: true,
              rawData: JSON.parse(JSON.stringify({ ...record(candidate.rawData), apifyMediaDigest: digest })) } }),
          ]);
          selectedIds.push(candidate.id);
          break;
        } catch (error) {
          failure = apifyError(error).replace(/https?:\/\/[^\s]+/gi, "[media URL]");
          await prisma.adMedia.update({ where: { id: asset.id }, data: { status: "FAILED", error: failure } });
        }
      }
      if (!selectedIds.includes(candidate.id)) await prisma.adEvidence.update({ where: { id: candidate.id }, data: { captureStatus: "CAPTURE_FAILED", captureError: failure } });
    }
    await prisma.adEvidence.updateMany({ where, data: { selectedForSlide: false, selectedForAnalysisEvidence: false } });
    if (selectedIds.length) await prisma.adEvidence.updateMany({ where: { id: { in: selectedIds } }, data: { selectedForSlide: true } });
    // Discard only queue entries, never records or files. Retain pending assets
    // for the remaining ranked candidates until five succeed or all are tried.
    const remainingIds = selectedIds.length < MAX_REPORT_CREATIVES_PER_SOURCE
      ? pending.filter(item => item.id !== candidate?.id).map(item => item.id) : [];
    await prisma.adMedia.updateMany({ where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: where, adEvidenceId: { notIn: remainingIds } }, data: { status: "DISCARDED", error: "Outside remaining representative media selection." } });
    // Candidates without URLs also need a poll; a queue count alone misses them.
    await prisma.adProviderRun.update({ where: { id: run.id }, data: { mediaStoredCount: selectedIds.length } });
  } finally {
    await prisma.adProviderRun.updateMany({ where: { id: run.id, processingStartedAt: lease }, data: { processingStartedAt: null } });
  }
}
