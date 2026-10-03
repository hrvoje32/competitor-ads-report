import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { capturePublicPage } from "../lib/automatic-capture";
import { safeCaptureText } from "../lib/browser/diagnostics";
import { prisma } from "../lib/prisma";

// Explicit diagnostic run only. Never invoke the automation route, collection APIs,
// or a retry loop: at most ONE existing Google ad and ONE existing Meta ad per run.
async function main() {
  const [brandReportId, outputDirectory, ...extra] = process.argv.slice(2);
  if (!brandReportId || !outputDirectory || extra.length) {
    throw new Error("Usage: node --import tsx scripts/diagnose-creative-capture.ts BRAND_REPORT_ID OUTPUT_DIRECTORY");
  }
  if (!process.env.BROWSER_WS_ENDPOINT || !process.env.DATABASE_URL) {
    throw new Error("Supply BROWSER_WS_ENDPOINT and DATABASE_URL through the execution environment. This script does not load .env files.");
  }
  // A fresh directory prevents accidental replacement of an earlier diagnostic run.
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: false, mode: 0o700 });
  for (const source of ["GOOGLE", "META"] as const) {
    const evidence = await prisma.adEvidence.findFirst({
      where: { brandReportId, source, OR: [{ snapshotUrl: { not: null } }, { sourceUrl: { not: null } }] },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { id: true, sourceUrl: true, snapshotUrl: true },
    });
    const url = evidence?.snapshotUrl || evidence?.sourceUrl;
    const name = source.toLowerCase();
    if (!url) {
      console.warn(`${source}: no existing ad URL; skipped.`);
      continue;
    }
    try {
      const capture = await capturePublicPage(url, source, { diagnosticFullPage: true });
      const extension = capture.contentType === "image/png" ? "png" : "webp";
      await writeFile(path.join(output, `${name}-evidence.${extension}`), capture.image, { mode: 0o600 });
      if (capture.diagnosticFullPage) {
        await writeFile(path.join(output, `${name}-full-page.png`), capture.diagnosticFullPage, { mode: 0o600 });
      }
      await writeFile(path.join(output, `${name}-diagnostics.json`), JSON.stringify({
        evidenceId: evidence?.id, method: capture.method,
        fullPageAvailable: Boolean(capture.diagnosticFullPage), ...capture.diagnostics,
      }, null, 2), { mode: 0o600 });
      console.log(`${source}: ${capture.method}; diagnostic artifacts saved.`);
    } catch (error) {
      const message = safeCaptureText(error instanceof Error ? error.message : "Capture failed.", url);
      await writeFile(path.join(output, `${name}-error.json`), JSON.stringify({ source, error: message }), { mode: 0o600 });
      console.error(`${source}: ${message}`);
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(safeCaptureText(error instanceof Error ? error.message : "Diagnostic run failed."));
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
