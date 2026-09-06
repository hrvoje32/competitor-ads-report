import { prisma } from "@/lib/prisma";

export function earlierReportDate(year: number, month: number) {
  return {
    OR: [
      { year: { lt: year } },
      { year, month: { lt: month } },
    ],
  };
}

export async function findPreviousCompletedBrandReport(brandId: string, year: number, month: number) {
  return prisma.brandReport.findFirst({
    where: {
      brandId,
      included: true,
      report: {
        status: "COMPLETE",
        ...earlierReportDate(year, month),
      },
    },
    orderBy: [
      { report: { year: "desc" } },
      { report: { month: "desc" } },
    ],
    select: {
      id: true,
      report: { select: { month: true, year: true } },
    },
  });
}

export function monthName(month: number, year: number, language: "HR" | "EN") {
  return new Intl.DateTimeFormat(language === "HR" ? "hr-HR" : "en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
