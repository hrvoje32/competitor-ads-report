import { prisma } from "@/lib/prisma";
import { filterBrandAd } from "@/lib/brand-ad-filter";
import { MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE, rankCaptureCandidates } from "@/lib/official-capture-policy";

// Also used after editing filters and by manual imports. Images and records stay
// intact; exclusions clear only their report selections and candidate rank.
export async function refreshBrandEvidence(brandReportId: string) {
  const report = await prisma.brandReport.findUnique({ where: { id: brandReportId }, include: { brand: { include: { metaPages: true } }, adEvidence: true } });
  if (!report) throw new Error("Brand report not found.");
  const evidence = report.adEvidence.map(item => ({ ...item, ...filterBrandAd(item, report.brand), captureCandidateRank: null as number | null }));
  for (const source of ["GOOGLE", "META"] as const) {
    const ranked = rankCaptureCandidates(evidence.filter(item => item.source === source))
      .filter(item => item.localImagePath || item.sourceUrl || item.snapshotUrl).slice(0, MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE);
    ranked.forEach((item, index) => { item.captureCandidateRank = index + 1; });
  }
  const changed = evidence.filter(item => {
    const original = report.adEvidence.find(row => row.id === item.id)!;
    return original.brandFilterStatus !== item.brandFilterStatus || original.brandFilterReason !== item.brandFilterReason
      || original.captureCandidateRank !== item.captureCandidateRank
      || (item.brandFilterStatus === "EXCLUDED" && (original.selectedForSlide || original.selectedForAnalysisEvidence));
  });
  if (changed.length) await prisma.$transaction(changed.map(item => prisma.adEvidence.update({ where: { id: item.id }, data: {
    brandFilterStatus: item.brandFilterStatus, brandFilterReason: item.brandFilterReason, captureCandidateRank: item.captureCandidateRank,
    ...(item.brandFilterStatus === "EXCLUDED" ? { selectedForSlide: false, selectedForAnalysisEvidence: false } : {}),
  } })));
  if ((report.analysisJson || report.analysisEditedJson) && changed.some(item => item.brandFilterStatus === "EXCLUDED" && (item.selectedForSlide || item.selectedForAnalysisEvidence))) {
    // Keep the original analysis inspectable, but don't export stale findings
    // after their supporting ads have been excluded by an edited filter.
    await prisma.brandReport.update({ where: { id: brandReportId }, data: { analysisNeedsRegeneration: true, approved: false } });
  }
  return evidence;
}
