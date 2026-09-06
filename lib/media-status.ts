import type { AdSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";

async function warningFor(brandReportId: string, source: AdSource) {
  const [failedDownloads, missingMedia] = await Promise.all([
    prisma.adMedia.count({ where: { status: "FAILED", adEvidence: { brandReportId, source } } }),
    prisma.adEvidence.count({ where: { brandReportId, source, captureStatus: "CAPTURE_FAILED", media: { none: {} } } }),
  ]);
  const warnings = [
    failedDownloads ? `${failedDownloads} media download${failedDownloads === 1 ? "" : "s"} failed` : "",
    missingMedia ? `${missingMedia} ad${missingMedia === 1 ? "" : "s"} did not include a downloadable image or thumbnail` : "",
  ].filter(Boolean);
  return warnings.length ? `${source === "GOOGLE" ? "Google" : "Meta"}: ${warnings.join("; ")}.` : null;
}

export async function refreshBrandMediaWarnings(brandReportId: string) {
  const [googleMediaError, metaMediaError] = await Promise.all([
    warningFor(brandReportId, "GOOGLE"),
    warningFor(brandReportId, "META"),
  ]);
  await prisma.brandReport.update({ where: { id: brandReportId }, data: { googleMediaError, metaMediaError } });
  return { googleMediaError, metaMediaError };
}
