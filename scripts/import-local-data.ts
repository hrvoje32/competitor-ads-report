import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

type ExportData = { brands: Array<Record<string, unknown>>; reports: Array<Record<string, unknown>>; brandReports: Array<Record<string, unknown>>; adEvidence: Array<Record<string, unknown>> };
const dates = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => key.endsWith("At") || key === "firstShown" || key === "lastShown" ? [key, value ? new Date(typeof value === "number" ? value : String(value)) : null] : [key, value]));
async function main() {
  if (!process.argv.includes("--confirm")) throw new Error("Refusing to import without --confirm.");
  const existing = await Promise.all([prisma.brand.count(), prisma.report.count(), prisma.brandReport.count(), prisma.adEvidence.count()]);
  if (existing.some(Boolean)) throw new Error("Target database is not empty. Refusing to overwrite existing data.");
  const data = JSON.parse(await readFile(path.join(process.cwd(), "migration", "local-export.json"), "utf8")) as ExportData;
  await prisma.$transaction(async tx => {
    for (const row of data.brands) await tx.brand.create({ data: dates(row) as never });
    for (const row of data.reports) await tx.report.create({ data: dates(row) as never });
    for (const row of data.brandReports) await tx.brandReport.create({ data: dates(row) as never });
    for (const row of data.adEvidence) await tx.adEvidence.create({ data: dates(row) as never });
  });
  console.log("Imported " + data.brands.length + " brands, " + data.reports.length + " reports, " + data.brandReports.length + " brand reports, and " + data.adEvidence.length + " evidence records.");
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1); });
