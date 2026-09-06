export function reportPeriod(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid report month or year.");
  }

  const startDate = `${year}-${String(month).padStart(2, "0")}-02`;
  const endDate = new Date(Date.UTC(year, month, -1)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function isoReportDate(value: Date | string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid report date.");
  return parsed.toISOString().slice(0, 10);
}

export function deliveryOverlapsAnalysisPeriod(
  deliveryStart: Date | string | null | undefined,
  deliveryEnd: Date | string | null | undefined,
  analysisStart: Date | string,
  analysisEnd: Date | string,
) {
  const start = new Date(`${isoReportDate(analysisStart)}T00:00:00.000Z`);
  const end = new Date(`${isoReportDate(analysisEnd)}T23:59:59.999Z`);
  const deliveredFrom = deliveryStart ? new Date(deliveryStart) : null;
  const deliveredTo = deliveryEnd ? new Date(deliveryEnd) : null;
  return (!deliveredTo || deliveredTo >= start) && (!deliveredFrom || deliveredFrom <= end);
}

export function googleTransparencyUrl(countryCode: string, googleDomain: string) {
  const url = new URL("https://adstransparency.google.com/");
  url.searchParams.set("region", countryCode.toUpperCase());
  url.searchParams.set("domain", googleDomain);
  return url;
}

export function datedGoogleTransparencyUrl(countryCode: string, googleDomain: string, startDate: Date | string, endDate: Date | string) {
  const url = googleTransparencyUrl(countryCode, googleDomain);
  url.searchParams.set("start-date", isoReportDate(startDate));
  url.searchParams.set("end-date", isoReportDate(endDate));
  return url.toString();
}

export function metaAdLibraryUrl(countryCode: string, pageId: string) {
  const url = new URL("https://www.facebook.com/ads/library/");
  url.searchParams.set("active_status", "all");
  url.searchParams.set("ad_type", "all");
  url.searchParams.set("country", countryCode.toUpperCase());
  url.searchParams.set("view_all_page_id", pageId);
  return url.toString();
}
