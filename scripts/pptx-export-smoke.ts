import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AdSource, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { saveEvidenceImage, deleteLocalUpload } from "../lib/uploads";
import { GET } from "../app/api/reports/[id]/export/route";

const prisma = new PrismaClient();
async function main() {
  const brand = await prisma.brand.findFirstOrThrow();
  const report = await prisma.report.create({ data: { title: "Č Ć Ž Š Đ", month: 9, year: 2026, brandReports: { create: { brandId: brand.id } } } });
  const brandReport = await prisma.brandReport.findFirstOrThrow({ where: { reportId: report.id, brandId: brand.id } });
  const buffer = await sharp({ create: { width: 100, height: 70, channels: 3, background: "#159b93" } }).png().toBuffer();
  const googlePath = await saveEvidenceImage(new File([buffer], "google.png", { type: "image/png" }), report, brand.id, "google");
  const metaPath = await saveEvidenceImage(new File([buffer], "meta.png", { type: "image/png" }), report, brand.id, "meta");
  await prisma.adEvidence.createMany({ data: [{ brandReportId: brandReport.id, source: AdSource.GOOGLE, localImagePath: googlePath, selectedForSlide: true, selectedForAnalysisEvidence: true, cropX: 10, cropY: 10, cropWidth: 60, cropHeight: 40 }, { brandReportId: brandReport.id, source: AdSource.META, localImagePath: metaPath, selectedForSlide: true, selectedForAnalysisEvidence: true }] });
  const response = await GET(new NextRequest(`http://localhost/api/reports/${report.id}/export`), { params: Promise.resolve({ id: report.id }) });
  if (!response.ok) throw new Error(`Export route returned ${response.status}`);
  const pptx = Buffer.from(await response.arrayBuffer());
  if (pptx.length === 0 || pptx.subarray(0, 2).toString() !== "PK") throw new Error("Export was not a non-empty PPTX package.");
  const output = path.join(process.cwd(), "generated", "pptx-export-smoke.pptx");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, pptx);
  await prisma.report.delete({ where: { id: report.id } });
  await Promise.all([deleteLocalUpload(googlePath), deleteLocalUpload(metaPath)]);
  console.log(output);
}
main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
