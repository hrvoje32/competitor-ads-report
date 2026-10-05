// Reuse existing status/message fields; no database migration is needed.
export const NO_USABLE_EVIDENCE = "NO_USABLE_EVIDENCE";
export const ANALYSIS_SKIPPED_NO_MEDIA = "Analysis skipped: no usable images were available. The report continued without visual findings for this brand.";

export function analysisWasSkipped(brand: { automationStatus?: string; automationError?: string | null }) {
  return brand.automationStatus === "READY" && brand.automationError === ANALYSIS_SKIPPED_NO_MEDIA;
}
