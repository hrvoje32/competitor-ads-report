import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { brandLogoObjectPath, evidenceObjectPath, fileExists, saveFile } from "@/lib/storage";

function localPath(value: string) { if (!value.startsWith("/uploads/")) throw new Error("Not a legacy upload path: " + value); return path.join(process.cwd(), "public", value); }
function contentType(value: string) { const ext = path.extname(value).toLowerCase(); return ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg"; }
async function main() {
  if (!process.argv.includes("--confirm")) throw new Error("Refusing to migrate files without --confirm.");
  let uploaded = 0, skipped = 0, missing = 0;
  for (const brand of await prisma.brand.findMany()) {
    if (!brand.logoPath?.startsWith("/uploads/")) { skipped++; continue; }
    try { const target = brandLogoObjectPath(brand.id); await saveFile({ path: target, contentType: contentType(brand.logoPath) }, await readFile(localPath(brand.logoPath))); await prisma.brand.update({ where: { id: brand.id }, data: { logoPath: target } }); uploaded++; } catch { missing++; }
  }
  const evidence = await prisma.adEvidence.findMany({ include: { brandReport: { include: { report: true } } } });
  for (const item of evidence) {
    if (!item.localImagePath?.startsWith("/uploads/")) { skipped++; continue; }
    try { const source = item.source === "GOOGLE" ? "google" : "meta"; const target = evidenceObjectPath(item.brandReport.report.id, item.brandReport.brandId, source, path.extname(item.localImagePath).slice(1) || "webp"); if (await fileExists(target)) { skipped++; continue; } await saveFile({ path: target, contentType: contentType(item.localImagePath) }, await readFile(localPath(item.localImagePath))); await prisma.adEvidence.update({ where: { id: item.id }, data: { localImagePath: target } }); uploaded++; } catch { missing++; }
  }
  console.log(JSON.stringify({ uploaded, skipped, missing, originalsDeleted: false }, null, 2));
}
main().finally(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1); });
