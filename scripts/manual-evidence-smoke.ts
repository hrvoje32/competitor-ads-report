import sharp from "sharp";
import { AdSource, PrismaClient } from "@prisma/client";
import { deleteLocalUpload, getCroppedImageBuffer, saveEvidenceImage } from "../lib/uploads";

const prisma = new PrismaClient();
async function main() {
  const brand = await prisma.brand.findFirstOrThrow();
  const report = await prisma.report.create({
    data: {
      title: "Smoke test",
      month: 9,
      year: 2026,
      startDate: new Date("2026-09-02T00:00:00.000Z"),
      endDate: new Date("2026-09-29T00:00:00.000Z"),
      brandReports: { create: { brandId: brand.id } },
    },
  });
  const brandReport = await prisma.brandReport.findFirstOrThrow({ where: { reportId: report.id, brandId: brand.id } });
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#126a67" } }).png().toBuffer();
  const files = [new File([png], "ad-one.png", { type: "image/png" }), new File([png], "ad-two.png", { type: "image/png" })];
  const paths = await Promise.all(files.map(file => saveEvidenceImage(file, report, brand.id, "google")));
  if (paths[0] === paths[1]) throw new Error("Unique structured upload paths failed.");
  const cropped = await getCroppedImageBuffer(paths[0], { cropX: 10, cropY: 10, cropWidth: 30, cropHeight: 20 });
  const metadata = await sharp(cropped).metadata();
  if (metadata.width !== 30 || metadata.height !== 20) throw new Error("Non-destructive crop helper failed.");
  await prisma.adEvidence.createMany({ data: Array.from({ length: 9 }, (_, sortOrder) => ({ brandReportId: brandReport.id, source: AdSource.GOOGLE, localImagePath: paths[sortOrder % 2], sortOrder, selectedForSlide: sortOrder < 8 })) });
  const selected = await prisma.adEvidence.count({ where: { brandReportId: brandReport.id, source: AdSource.GOOGLE, selectedForSlide: true } });
  if (selected !== 8) throw new Error("Eight-image slide selection limit failed.");
  await prisma.report.delete({ where: { id: report.id } });
  await Promise.all(paths.map(deleteLocalUpload));
  console.log("manual evidence smoke test passed");
}
main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
