import { prisma } from "@/lib/prisma";
import { deleteFile, getFileSize } from "@/lib/storage";

type MediaSource = "GOOGLE" | "META";
type PathEntry = { path: string; source: MediaSource; byteSize: number | null };

async function reportMediaEntries(reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      year: true,
      month: true,
      mediaCleanedAt: true,
      brandReports: {
        select: {
          brandId: true,
          adEvidence: {
            select: {
              source: true,
              localImagePath: true,
              storedMediaBytes: true,
              media: { select: { storagePath: true, byteSize: true } },
            },
          },
        },
      },
    },
  });
  if (!report) throw new Error("Report not found.");
  const entries = new Map<string, PathEntry>();
  for (const brandReport of report.brandReports) {
    for (const evidence of brandReport.adEvidence) {
      if (evidence.localImagePath) entries.set(evidence.localImagePath, {
        path: evidence.localImagePath,
        source: evidence.source,
        byteSize: evidence.storedMediaBytes,
      });
      for (const media of evidence.media) {
        if (!media.storagePath) continue;
        const current = entries.get(media.storagePath);
        entries.set(media.storagePath, {
          path: media.storagePath,
          source: evidence.source,
          byteSize: current?.byteSize ?? media.byteSize,
        });
      }
    }
  }
  return { report, entries: [...entries.values()] };
}

export async function getReportMediaSummary(reportId: string) {
  const { report, entries } = await reportMediaEntries(reportId);
  const measured = await Promise.all(entries.map(async entry => {
    if (entry.byteSize !== null) return entry;
    try { return { ...entry, byteSize: await getFileSize(entry.path) }; }
    catch { return entry; }
  }));
  const googleBytes = measured.filter(entry => entry.source === "GOOGLE").reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0);
  const metaBytes = measured.filter(entry => entry.source === "META").reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0);
  return {
    googleBytes,
    metaBytes,
    totalBytes: googleBytes + metaBytes,
    googleFiles: measured.filter(entry => entry.source === "GOOGLE").length,
    metaFiles: measured.filter(entry => entry.source === "META").length,
    unknownSizeFiles: measured.filter(entry => entry.byteSize === null).length,
    cleaned: Boolean(report.mediaCleanedAt && !entries.length),
  };
}

export async function cleanupReportMedia(reportId: string) {
  const { report, entries } = await reportMediaEntries(reportId);
  const brandIds = new Set(report.brandReports.map(brandReport => brandReport.brandId));
  const legacyPeriodPrefix = `reports/${report.year}-${String(report.month).padStart(2, "0")}/`;
  const safeEntries = entries.filter(entry => {
    const normalized = entry.path.replace(/^\/+/, "");
    if (normalized.startsWith(`reports/${reportId}/`)) return true;
    if (!normalized.startsWith(legacyPeriodPrefix)) return false;
    return [...brandIds].some(brandId => normalized.startsWith(`${legacyPeriodPrefix}${brandId}/`));
  });
  const paths = safeEntries.map(entry => entry.path);
  const outsideReferences = paths.length ? await prisma.adEvidence.findMany({
    where: {
      brandReport: { reportId: { not: reportId } },
      OR: [
        { localImagePath: { in: paths } },
        { media: { some: { storagePath: { in: paths } } } },
      ],
    },
    select: { localImagePath: true, media: { select: { storagePath: true } } },
  }) : [];
  const shared = new Set(outsideReferences.flatMap(item =>
    [item.localImagePath, ...item.media.map(media => media.storagePath)].filter((path): path is string => Boolean(path))
  ));
  const deletable = paths.filter(path => !shared.has(path));
  const results = await Promise.allSettled(deletable.map(path => deleteFile(path)));
  const deleted = deletable.filter((_, index) => results[index].status === "fulfilled");
  if (deleted.length) await prisma.$transaction([
    prisma.adEvidence.updateMany({
      where: { brandReport: { reportId }, localImagePath: { in: deleted } },
      data: {
        localImagePath: null,
        storedMediaBytes: null,
        cropX: null,
        cropY: null,
        cropWidth: null,
        cropHeight: null,
        captureStatus: "PENDING",
        captureError: "Report media was cleaned up after export.",
      },
    }),
    prisma.adMedia.updateMany({
      where: { adEvidence: { brandReport: { reportId } }, storagePath: { in: deleted } },
      data: { storagePath: null, byteSize: null, status: "DISCARDED", error: "Report media was cleaned up after export." },
    }),
  ]);
  await prisma.report.update({ where: { id: reportId }, data: { mediaCleanedAt: new Date() } });
  return {
    deletedFiles: deleted.length,
    deletedBytes: safeEntries.filter(entry => deleted.includes(entry.path)).reduce((sum, entry) => sum + (entry.byteSize ?? 0), 0),
    sharedFilesSkipped: shared.size,
    unsafePathsSkipped: entries.length - safeEntries.length,
    failures: results.filter(result => result.status === "rejected").length,
  };
}
