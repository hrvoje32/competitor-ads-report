type EvidenceSummary = {
  source: "GOOGLE" | "META";
  localImagePath: string | null;
  selectedForSlide: boolean;
  selectedForAnalysisEvidence: boolean;
};

type BrandReportSummary = {
  analysisJson: string | null;
  analysisEditedJson: string | null;
  googleStatus?: string;
  metaStatus?: string;
  googleError?: string | null;
  metaError?: string | null;
  brand: { name: string };
  adEvidence: EvidenceSummary[];
};

export function reportExportWarnings(brandReports: BrandReportSummary[]) {
  return brandReports.flatMap(brandReport => {
    const warnings: string[] = [];
    const selectedGoogle = brandReport.adEvidence.filter(item => item.source === "GOOGLE" && item.selectedForSlide);
    const selectedMeta = brandReport.adEvidence.filter(item => item.source === "META" && item.selectedForSlide);
    const selectedAnalysis = brandReport.adEvidence.filter(item => item.selectedForAnalysisEvidence);

    if (!selectedGoogle.length) warnings.push(brandReport.googleStatus === "FAILED" ? `${brandReport.brand.name}: Google source failed${brandReport.googleError ? ` — ${brandReport.googleError}` : ""}` : `${brandReport.brand.name}: No Google evidence selected`);
    if (!selectedMeta.length) warnings.push(brandReport.metaStatus === "FAILED" ? `${brandReport.brand.name}: Meta source failed${brandReport.metaError ? ` — ${brandReport.metaError}` : ""}` : `${brandReport.brand.name}: No Social evidence selected`);
    if (!brandReport.analysisEditedJson && !brandReport.analysisJson) warnings.push(`${brandReport.brand.name}: Analysis has not been generated`);
    if ([...selectedGoogle, ...selectedMeta, ...selectedAnalysis].some(item => !item.localImagePath)) {
      warnings.push(`${brandReport.brand.name}: selected evidence is missing an uploaded screenshot`);
    }
    if (selectedGoogle.length > 8) warnings.push(`${brandReport.brand.name}: more than 8 Google images are selected`);
    if (selectedMeta.length > 8) warnings.push(`${brandReport.brand.name}: more than 8 Social images are selected`);
    if (selectedAnalysis.length > 3) warnings.push(`${brandReport.brand.name}: more than 3 analysis images are selected`);
    return warnings;
  });
}

export function reportExportBlocked(brandReports: BrandReportSummary[]) {
  return brandReports.some(brandReport => {
    const selected = brandReport.adEvidence.filter(item => item.selectedForSlide || item.selectedForAnalysisEvidence);
    const googleCount = selected.filter(item => item.source === "GOOGLE" && item.selectedForSlide).length;
    const metaCount = selected.filter(item => item.source === "META" && item.selectedForSlide).length;
    const analysisCount = selected.filter(item => item.selectedForAnalysisEvidence).length;
    return googleCount > 8 || metaCount > 8 || analysisCount > 3 || selected.some(item => !item.localImagePath);
  });
}
