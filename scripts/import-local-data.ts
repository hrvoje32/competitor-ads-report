import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { reportPeriod } from "@/lib/report-period";

type ExportData = { brands: Array<Record<string, unknown>>; reports: Array<Record<string, unknown>>; brandReports: Array<Record<string, unknown>>; adEvidence: Array<Record<string, unknown>> };
const dates = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => key.endsWith("At") || ["startDate", "endDate", "firstShown", "lastShown"].includes(key) ? [key, value ? new Date(typeof value === "number" ? value : String(value)) : null] : [key, value]));
function reportDates(row: Record<string, unknown>) {
  const output = dates(row);
  if (!output.startDate || !output.endDate) {
    const period = reportPeriod(Number(row.year), Number(row.month));
    output.startDate = new Date(`${period.startDate}T00:00:00.000Z`);
    output.endDate = new Date(`${period.endDate}T00:00:00.000Z`);
  }
  return output;
}
async function main() {
  if (!process.argv.includes("--confirm")) throw new Error("Refusing to import without --confirm.");
  const existing = await Promise.all([prisma.brand.count(), prisma.report.count(), prisma.brandReport.count(), prisma.adEvidence.count()]);
  if (existing.some(Boolean)) throw new Error("Target database is not empty. Refusing to overwrite existing data.");
  const data = JSON.parse(await readFile(path.join(process.cwd(), "migration", "local-export.json"), "utf8")) as ExportData;
  await prisma.$transaction(async tx => {
    for (const row of data.brands) await tx.brand.create({ data: dates(row) as never });
    for (const row of data.reports) await tx.report.create({ data: reportDates(row) as never });
    for (const row of data.brandReports) await tx.brandReport.create({ data: dates(row) as never });
    for (const row of data.adEvidence) await tx.adEvidence.create({ data: dates(row) as never });
  });
  console.log("Imported " + data.brands.length + " brands, " + data.reports.length + " reports, " + data.brandReports.length + " brand reports, and " + data.adEvidence.length + " evidence records.");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1); });
