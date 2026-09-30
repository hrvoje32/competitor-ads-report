"use server";

import { estimateCreativesQuery, type GoogleQueryEstimate } from "@/lib/google-ads-transparency";
import { prisma } from "@/lib/prisma";
import { isoReportDate } from "@/lib/report-period";

export async function estimateGoogleAdsForReport(reportId: string, brandId: string, brandReportId: string): Promise<{ estimate: GoogleQueryEstimate } | { error: string }> {
  try {
    const brandReport = await prisma.brandReport.findFirst({
      where: { id: brandReportId, reportId, brandId },
      include: { brand: { include: { googleAdvertisers: true } }, report: true },
    });
    if (!brandReport) return { error: "Brand report was not found." };
    const advertiserIds = brandReport.brand.googleAdvertisers.map(item => item.advertiserId);
    if (!advertiserIds.length) return { error: "Add Google Advertiser IDs in the brand settings before estimating." };
    const estimate = await estimateCreativesQuery(
      advertiserIds,
      brandReport.report.countryCode,
      isoReportDate(brandReport.report.startDate),
      isoReportDate(brandReport.report.endDate),
    );
    return { estimate };
  } catch {
    // Upstream authentication errors can contain credentials or account details.
    return { error: "Unable to estimate the BigQuery scan. Check Google connection settings and BigQuery permissions, then retry." };
  }
}
