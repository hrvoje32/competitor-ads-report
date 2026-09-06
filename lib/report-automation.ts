import crypto from "node:crypto";
import type { AdEvidence, AdProviderRun, Prisma } from "@prisma/client";
import sharp from "sharp";
import { apifyError, getApifyDatasetItems, getApifyRun, startApifyActor } from "@/lib/ad-providers/apify";
import { googleApifyProvider, normalizeGoogleApifyAd } from "@/lib/ad-providers/google/apify";
import { metaApifyProvider, normalizeMetaApifyAd } from "@/lib/ad-providers/meta/apify";
import type { AdProviderSource, CollectionRequest, NormalizedAd } from "@/lib/ad-providers/types";
import { downloadAndProcessImage, googleTextEvidenceCard, storeProviderImage } from "@/lib/ad-media";
import { prisma } from "@/lib/prisma";
import { deliveryOverlapsAnalysisPeriod, isoReportDate } from "@/lib/report-period";
import { deleteFile, downloadFile } from "@/lib/storage";
import { MAX_REPRESENTATIVE_MEDIA_PER_SOURCE } from "@/lib/storage-policy";

const MEDIA_BATCH_SIZE = 12;
const TERMINAL_APIFY_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

type LoadedBrandReport = Awaited<ReturnType<typeof loadBrandReport>>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown automation error.";
}

async function loadBrandReport(brandReportId: string) {
  return prisma.brandReport.findUnique({
    where: { id: brandReportId },
    include: {
      brand: { include: { metaPages: true } },
      report: true,
      providerRuns: true,
    },
  });
}

function collectionRequest(brandReport: NonNullable<LoadedBrandReport>): CollectionRequest {
  return {
    brandName: brandReport.brand.name,
    googleDomain: brandReport.brand.googleDomain,
    metaPageIds: brandReport.brand.metaPages.map(item => item.pageId),
    countryCode: brandReport.report.countryCode,
    startDate: isoReportDate(brandReport.report.startDate),
    endDate: isoReportDate(brandReport.report.endDate),
    maxResults: 500,
  };
}

function providerFor(source: AdProviderSource, request: CollectionRequest) {
  return source === "GOOGLE" ? googleApifyProvider(request) : metaApifyProvider(request);
}

function sourceStatusData(source: AdProviderSource, status: "PENDING" | "FETCHING" | "CAPTURING" | "READY" | "FAILED", error: string | null = null) {
  return source === "GOOGLE"
    ? { googleStatus: status, googleError: error }
    : { metaStatus: status, metaError: error };
}

async function failProvider(brandReportId: string, source: AdProviderSource, message: string) {
  await prisma.$transaction([
    prisma.adProviderRun.updateMany({
      where: { brandReportId, source },
      data: { status: "FAILED", error: message, completedAt: new Date() },
    }),
    prisma.brandReport.update({ where: { id: brandReportId }, data: sourceStatusData(source, "FAILED", message) }),
  ]);
}

async function startSource(brandReport: NonNullable<LoadedBrandReport>, source: AdProviderSource) {
  let provider;
  try {
    provider = providerFor(source, collectionRequest(brandReport));
  } catch (error) {
    const message = errorMessage(error);
    const actorId = source === "GOOGLE"
      ? process.env.APIFY_GOOGLE_ACTOR_ID || "hyperbach/google-ads-transparency-scraper"
      : process.env.APIFY_META_ACTOR_ID || "webdata_labs/meta-ads-library-scraper";
    await prisma.adProviderRun.upsert({
      where: { brandReportId_source: { brandReportId: brandReport.id, source } },
      create: { brandReportId: brandReport.id, source, actorId, status: "FAILED", error: message, completedAt: new Date() },
      update: { actorId, runId: null, datasetId: null, status: "FAILED", error: message, completedAt: new Date(), itemsPersistedAt: null },
    });
    await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(source, "FAILED", message) });
    return { source, started: false, error: message };
  }

  await prisma.adProviderRun.upsert({
    where: { brandReportId_source: { brandReportId: brandReport.id, source } },
    create: { brandReportId: brandReport.id, source, actorId: provider.actorId, inputJson: provider.input as Prisma.InputJsonValue },
    update: {
      provider: "APIFY", actorId: provider.actorId, inputJson: provider.input as Prisma.InputJsonValue,
      runId: null, datasetId: null, status: "PENDING", error: null, itemCount: 0,
      mediaStoredCount: 0, itemsPersistedAt: null, processingStartedAt: null,
      startedAt: null, completedAt: null,
    },
  });
  await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(source, "FETCHING") });
  try {
    const run = await startApifyActor(provider.actorId, provider.input);
    await prisma.adProviderRun.update({
      where: { brandReportId_source: { brandReportId: brandReport.id, source } },
      data: { runId: run.runId, datasetId: run.datasetId, status: "RUNNING", startedAt: new Date() },
    });
    return { source, started: true, runId: run.runId };
  } catch (error) {
    const message = apifyError(error);
    await failProvider(brandReport.id, source, message);
    return { source, started: false, error: message };
  }
}

export async function startBrandAutomation(brandReportId: string, options: { failedOnly?: boolean } = {}) {
  const brandReport = await loadBrandReport(brandReportId);
  if (!brandReport) throw new Error("Brand report not found.");
  const failedSources = (["GOOGLE", "META"] as const).filter(source =>
    source === "GOOGLE" ? brandReport.googleStatus === "FAILED" : brandReport.metaStatus === "FAILED"
  );
  const sources = options.failedOnly ? failedSources : (["GOOGLE", "META"] as const);
  await prisma.brandReport.update({
    where: { id: brandReportId },
    data: {
      automationStatus: sources.length ? "FETCHING" : "CAPTURING",
      automationError: null,
      googleMediaError: null,
      metaMediaError: null,
      automationStartedAt: new Date(),
      automationEndedAt: null,
    },
  });
  await prisma.report.update({ where: { id: brandReport.reportId }, data: { mediaCleanedAt: null } });
  const results = await Promise.all(sources.map(source => startSource(brandReport, source)));
  return { brandReportId, results };
}

function json(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function usefulRawData(item: NormalizedAd) {
  const raw = item.rawData ?? {};
  const fields = [
    "campaignId", "campaign_id", "adSetId", "adset_id", "groupId", "group_id",
    "displayUrl", "display_url", "currency", "languages", "publisherPlatforms", "publisher_platforms",
  ];
  const selected = Object.fromEntries(fields.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  return {
    ...selected,
    advertiserId: item.advertiserId,
    advertiserName: item.advertiserName,
    imageUrls: item.imageUrls,
    videoUrls: item.videoUrls,
    videoThumbnailUrls: item.videoThumbnailUrls,
  };
}

function dateOverlaps(item: NormalizedAd, request: CollectionRequest) {
  return deliveryOverlapsAnalysisPeriod(item.startDate, item.endDate, request.startDate, request.endDate);
}

function belongsToBrand(item: NormalizedAd, request: CollectionRequest) {
  if (item.source === "META") return Boolean(item.advertiserId && request.metaPageIds.includes(item.advertiserId));
  return true;
}

function mediaCandidates(item: NormalizedAd) {
  const videoFirst = item.format?.toLowerCase().includes("video") && item.videoThumbnailUrls.length;
  const ordered = videoFirst
    ? [
      ...item.videoThumbnailUrls.map(sourceUrl => ({ sourceUrl, kind: "VIDEO_THUMBNAIL" as const })),
      ...item.imageUrls.map(sourceUrl => ({ sourceUrl, kind: "IMAGE" as const })),
    ]
    : [
      ...item.imageUrls.map(sourceUrl => ({ sourceUrl, kind: "IMAGE" as const })),
      ...item.videoThumbnailUrls.map(sourceUrl => ({ sourceUrl, kind: "VIDEO_THUMBNAIL" as const })),
    ];
  return ordered.filter((candidate, index, all) => all.findIndex(item => item.sourceUrl === candidate.sourceUrl) === index);
}

async function prepareEvidenceMetadata(brandReportId: string, source: AdProviderSource) {
  const evidence = await prisma.adEvidence.findMany({
    where: { brandReportId, source },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const prepared = evidence.map(item => {
    const text = normalizedEvidenceText(item);
    return { item, text, textHash: crypto.createHash("sha256").update(text).digest("hex") };
  });
  const parents = prepared.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left: number, right: number) => { const a = find(left), b = find(right); if (a !== b) parents[b] = a; };
  for (let left = 0; left < prepared.length; left++) {
    for (let right = left + 1; right < prepared.length; right++) {
      const a = prepared[left], b = prepared[right];
      const similarity = textSimilarity(a.text, b.text);
      const sameCopy = Boolean(a.text && a.textHash === b.textHash);
      const similarCopy = a.text.split(" ").length >= 3 && b.text.split(" ").length >= 3 && similarity >= .8;
      const sameLandingPage = Boolean(a.item.landingPageUrl && a.item.landingPageUrl === b.item.landingPageUrl && similarity >= .55);
      if (sameCopy || similarCopy || sameLandingPage) union(left, right);
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < prepared.length; index++) {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  }
  if (prepared.length) await prisma.$transaction(prepared.map((entry, index) => {
    const members = groups.get(find(index))!;
    const score = Math.log2(members.length + 1) * 12 +
      (entry.item.headline ? 10 : 0) + (entry.item.body ? 8 : 0) +
      (entry.item.description ? 4 : 0) + (entry.item.cta ? 3 : 0) +
      (entry.item.lastShown ? 5 : 0) + (entry.item.format ? 2 : 0);
    return prisma.adEvidence.update({
      where: { id: entry.item.id },
      data: {
        normalizedTextHash: entry.textHash,
        duplicateGroupKey: `${source}:${prepared[members[0]].item.id}`,
        duplicateGroupCount: members.length,
        representativeScore: score,
        selectedForSlide: false,
        selectedForAnalysisEvidence: false,
      },
    });
  }));
}

async function removePreviousImportedEvidence(brandReportId: string, source: AdProviderSource) {
  const evidence = await prisma.adEvidence.findMany({
    where: { brandReportId, source, externalId: { not: null } },
    include: { media: true },
  });
  const paths = evidence.flatMap(item => [item.localImagePath, ...item.media.map(media => media.storagePath)])
    .filter((path): path is string => Boolean(path));
  if (evidence.length) await prisma.adEvidence.deleteMany({ where: { id: { in: evidence.map(item => item.id) } } });
  await Promise.allSettled([...new Set(paths)].map(path => deleteFile(path)));
}

async function persistNormalizedAds(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun, rows: Record<string, unknown>[]) {
  const request = collectionRequest(brandReport);
  const normalize = run.source === "GOOGLE" ? normalizeGoogleApifyAd : normalizeMetaApifyAd;
  const ads = rows.map(normalize).filter((item): item is NormalizedAd => Boolean(item))
    .filter(item => dateOverlaps(item, request) && belongsToBrand(item, request))
    .filter((item, index, all) => all.findIndex(candidate => candidate.externalId === item.externalId) === index);

  await removePreviousImportedEvidence(brandReport.id, run.source);
  for (const [index, item] of ads.entries()) {
    const evidence = await prisma.adEvidence.create({
      data: {
        brandReportId: brandReport.id,
        source: item.source,
        externalId: item.externalId,
        sourceUrl: item.sourceUrl,
        snapshotUrl: item.sourceUrl,
        landingPageUrl: item.landingPageUrl,
        headline: item.headline,
        body: item.bodyText,
        description: item.description,
        cta: item.cta,
        platform: item.platform,
        format: item.format,
        firstShown: item.startDate,
        lastShown: item.endDate,
        rawData: json(usefulRawData(item)),
        notes: JSON.stringify({
          importedFrom: "apify",
          actorId: run.actorId,
          advertiserId: item.advertiserId,
          advertiserName: item.advertiserName,
          videoUrls: item.videoUrls,
        }),
        sortOrder: index,
        captureStatus: "PENDING",
      },
    });
    const candidates = mediaCandidates(item);
    if (candidates.length) {
      await prisma.adMedia.createMany({
        data: candidates.map((candidate, mediaIndex) => ({
          adEvidenceId: evidence.id,
          sourceUrl: candidate.sourceUrl,
          kind: candidate.kind,
          sortOrder: mediaIndex,
        })),
        skipDuplicates: true,
      });
    }
  }
  await prisma.adProviderRun.update({
    where: { id: run.id },
    data: { itemCount: ads.length, itemsPersistedAt: new Date(), processingStartedAt: new Date() },
  });
  await prepareEvidenceMetadata(brandReport.id, run.source);
}

async function processMediaBatch(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  const stale = new Date(Date.now() - 5 * 60_000);
  await prisma.adMedia.updateMany({
    where: { status: "DOWNLOADING", updatedAt: { lt: stale }, adEvidence: { brandReportId: brandReport.id, source: run.source } },
    data: { status: "PENDING", error: null },
  });
  let selected = await prisma.adEvidence.findMany({
    where: { brandReportId: brandReport.id, source: run.source, localImagePath: { not: null } },
    orderBy: [{ representativeScore: "desc" }, { sortOrder: "asc" }],
  });
  if (selected.length) await prisma.adEvidence.updateMany({
    where: { id: { in: selected.slice(0, MAX_REPRESENTATIVE_MEDIA_PER_SOURCE).map(item => item.id) } },
    data: { selectedForSlide: true },
  });
  if (selected.length >= MAX_REPRESENTATIVE_MEDIA_PER_SOURCE) {
    await prisma.adMedia.updateMany({
      where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: { brandReportId: brandReport.id, source: run.source } },
      data: { status: "DISCARDED", error: "Representative storage limit reached." },
    });
    return;
  }
  const selectedGroups = selected.map(item => item.duplicateGroupKey).filter((value): value is string => Boolean(value));
  if (selectedGroups.length) {
    await prisma.adMedia.updateMany({
      where: { status: "PENDING", adEvidence: { brandReportId: brandReport.id, source: run.source, duplicateGroupKey: { in: selectedGroups } } },
      data: { status: "DISCARDED", error: "Duplicate copy group already has a representative." },
    });
  }

  const allPending = await prisma.adMedia.findMany({
    where: { status: "PENDING", adEvidence: { brandReportId: brandReport.id, source: run.source } },
    include: { adEvidence: true },
  });
  const pending = allPending
    .sort((left, right) =>
      (right.adEvidence.representativeScore ?? 0) - (left.adEvidence.representativeScore ?? 0) ||
      left.adEvidence.sortOrder - right.adEvidence.sortOrder || left.sortOrder - right.sortOrder
    )
    .slice(0, MEDIA_BATCH_SIZE);
  for (const media of pending) {
    if (selected.length >= MAX_REPRESENTATIVE_MEDIA_PER_SOURCE) break;
    if (selected.some(item => item.duplicateGroupKey && item.duplicateGroupKey === media.adEvidence.duplicateGroupKey)) {
      await prisma.adMedia.update({ where: { id: media.id }, data: { status: "DISCARDED", error: "Duplicate copy group already has a representative." } });
      continue;
    }
    const claimed = await prisma.adMedia.updateMany({ where: { id: media.id, status: "PENDING" }, data: { status: "DOWNLOADING", error: null } });
    if (!claimed.count) continue;
    try {
      const output = await downloadAndProcessImage(media.sourceUrl);
      const imageHash = await perceptualHash(output);
      const nearDuplicate = selected.some(item =>
        item.perceptualHash && hammingDistance(item.perceptualHash, imageHash) <= 8 &&
        (!normalizedEvidenceText(item) || !normalizedEvidenceText(media.adEvidence) || textSimilarity(normalizedEvidenceText(item), normalizedEvidenceText(media.adEvidence)) >= .35)
      );
      if (nearDuplicate) {
        await prisma.$transaction([
          prisma.adMedia.update({ where: { id: media.id }, data: { status: "DISCARDED", error: "Visual duplicate of a selected representative." } }),
          prisma.adEvidence.update({ where: { id: media.adEvidenceId }, data: { perceptualHash: imageHash } }),
        ]);
        continue;
      }
      const stored = await storeProviderImage(output, brandReport.report, brandReport.brandId, run.source, media.adEvidence.externalId || media.adEvidence.id);
      await prisma.$transaction([
        prisma.adMedia.update({ where: { id: media.id }, data: { status: "STORED", storagePath: stored.path, byteSize: stored.byteSize, error: null } }),
        prisma.adMedia.updateMany({
          where: {
            id: { not: media.id },
            status: "PENDING",
            adEvidence: { brandReportId: brandReport.id, source: run.source, duplicateGroupKey: media.adEvidence.duplicateGroupKey },
          },
          data: { status: "DISCARDED", error: "Duplicate group already has a selected representative." },
        }),
        prisma.adEvidence.update({
          where: { id: media.adEvidenceId },
          data: { localImagePath: stored.path, storedMediaBytes: stored.byteSize, perceptualHash: imageHash, selectedForSlide: true, captureStatus: "READY", captureError: null },
        }),
      ]);
      selected = [...selected, { ...media.adEvidence, localImagePath: stored.path, storedMediaBytes: stored.byteSize, perceptualHash: imageHash, selectedForSlide: true }];
    } catch (error) {
      await prisma.adMedia.update({ where: { id: media.id }, data: { status: "FAILED", error: errorMessage(error) } });
    }
  }

  if (selected.length >= MAX_REPRESENTATIVE_MEDIA_PER_SOURCE) {
    await prisma.adMedia.updateMany({
      where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: { brandReportId: brandReport.id, source: run.source } },
      data: { status: "DISCARDED", error: "Representative storage limit reached." },
    });
    return;
  }

  const mediaStillPending = await prisma.adMedia.count({
    where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: { brandReportId: brandReport.id, source: run.source } },
  });
  if (mediaStillPending) return;

  if (run.source === "GOOGLE") {
    const remainingSlots = MAX_REPRESENTATIVE_MEDIA_PER_SOURCE - selected.length;
    const withoutImageCandidates = await prisma.adEvidence.findMany({
      where: {
        brandReportId: brandReport.id,
        source: run.source,
        localImagePath: null,
        captureStatus: "PENDING",
        duplicateGroupKey: { notIn: selected.map(item => item.duplicateGroupKey).filter((value): value is string => Boolean(value)) },
        OR: [{ headline: { not: null } }, { body: { not: null } }, { description: { not: null } }],
      },
      orderBy: [{ representativeScore: "desc" }, { sortOrder: "asc" }],
    });
    const withoutImage = withoutImageCandidates
      .filter((item, index, all) => all.findIndex(candidate => candidate.duplicateGroupKey === item.duplicateGroupKey) === index)
      .slice(0, remainingSlots);
    for (const evidence of withoutImage) {
      try {
        const raw = evidence.rawData && typeof evidence.rawData === "object" && !Array.isArray(evidence.rawData)
          ? evidence.rawData as Record<string, unknown>
          : {};
        const card = await googleTextEvidenceCard({
          headline: evidence.headline,
          body: [evidence.body, evidence.description].filter(Boolean).join("\n"),
          displayUrl: typeof raw.display_url === "string" ? raw.display_url : evidence.landingPageUrl,
          cta: evidence.cta,
        });
        const stored = await storeProviderImage(card, brandReport.report, brandReport.brandId, run.source, evidence.externalId || evidence.id);
        await prisma.adEvidence.update({
          where: { id: evidence.id },
          data: { localImagePath: stored.path, storedMediaBytes: stored.byteSize, selectedForSlide: true, captureStatus: "READY", captureError: null },
        });
      } catch (error) {
        await prisma.adEvidence.update({ where: { id: evidence.id }, data: { captureStatus: "CAPTURE_FAILED", captureError: errorMessage(error) } });
      }
    }
  } else {
    await prisma.adEvidence.updateMany({
      where: { brandReportId: brandReport.id, source: run.source, localImagePath: null, captureStatus: "PENDING", media: { none: {} } },
      data: { captureStatus: "CAPTURE_FAILED", captureError: "No media URL was provided." },
    });
    const failedEvidence = await prisma.adEvidence.findMany({
      where: { brandReportId: brandReport.id, source: run.source, localImagePath: null, captureStatus: "PENDING", media: { some: { status: "FAILED" } } },
      include: { media: { where: { status: "FAILED" }, orderBy: { sortOrder: "asc" }, take: 1 } },
    });
    if (failedEvidence.length) await prisma.$transaction(failedEvidence.map(evidence => prisma.adEvidence.update({
      where: { id: evidence.id },
      data: { captureStatus: "CAPTURE_FAILED", captureError: evidence.media[0]?.error || "Media could not be processed." },
    })));
  }
}

async function finishProviderIfReady(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  const pendingMedia = await prisma.adMedia.count({
    where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: { brandReportId: brandReport.id, source: run.source } },
  });
  if (pendingMedia) return;
  const [stored, failedDownloads, missingMedia] = await Promise.all([
    prisma.adEvidence.count({ where: { brandReportId: brandReport.id, source: run.source, selectedForSlide: true, localImagePath: { not: null } } }),
    prisma.adMedia.count({ where: { status: "FAILED", adEvidence: { brandReportId: brandReport.id, source: run.source } } }),
    prisma.adEvidence.count({ where: { brandReportId: brandReport.id, source: run.source, captureStatus: "CAPTURE_FAILED" } }),
  ]);
  const label = run.source === "GOOGLE" ? "Google" : "Meta";
  const warnings = [
    failedDownloads ? `${failedDownloads} media download${failedDownloads === 1 ? "" : "s"} failed` : "",
    missingMedia ? `${missingMedia} ad${missingMedia === 1 ? "" : "s"} did not include a downloadable image or thumbnail` : "",
  ].filter(Boolean);
  const warning = warnings.length ? `${label}: ${warnings.join("; ")}.` : null;
  await prisma.$transaction([
    prisma.adProviderRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", mediaStoredCount: stored, completedAt: new Date() } }),
    prisma.brandReport.update({
      where: { id: brandReport.id },
      data: {
        ...sourceStatusData(run.source, "READY"),
        ...(run.source === "GOOGLE" ? { googleMediaError: warning } : { metaMediaError: warning }),
      },
    }),
  ]);
}

async function advanceProviderRun(brandReport: NonNullable<LoadedBrandReport>, initial: AdProviderRun) {
  let run = initial;
  if (run.status === "RUNNING") {
    if (!run.runId) return failProvider(brandReport.id, run.source, "Apify run ID is missing.");
    try {
      const remote = await getApifyRun(run.runId);
      if (!TERMINAL_APIFY_STATUSES.has(remote.status)) return;
      if (remote.status !== "SUCCEEDED") return failProvider(brandReport.id, run.source, `Apify Actor run ended with status ${remote.status}.`);
      if (!remote.datasetId) return failProvider(brandReport.id, run.source, "Apify Actor completed without a dataset.");
      run = await prisma.adProviderRun.update({
        where: { id: run.id },
        data: { datasetId: remote.datasetId, status: "PROCESSING", processingStartedAt: new Date(), error: null },
      });
      await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(run.source, "CAPTURING") });
    } catch (error) {
      return failProvider(brandReport.id, run.source, apifyError(error));
    }
  }
  if (run.status !== "PROCESSING") return;
  try {
    if (!run.itemsPersistedAt) {
      if (!run.datasetId) throw new Error("Apify dataset ID is missing.");
      const rows = await getApifyDatasetItems(run.datasetId);
      await persistNormalizedAds(brandReport, run, rows);
      run = await prisma.adProviderRun.findUniqueOrThrow({ where: { id: run.id } });
    }
    await processMediaBatch(brandReport, run);
    await finishProviderIfReady(brandReport, run);
  } catch (error) {
    await failProvider(brandReport.id, run.source, apifyError(error));
  }
}

export async function advanceBrandCollection(brandReportId: string) {
  let brandReport = await loadBrandReport(brandReportId);
  if (!brandReport) throw new Error("Brand report not found.");
  await Promise.all(brandReport.providerRuns.map(run => advanceProviderRun(brandReport!, run)));
  brandReport = await loadBrandReport(brandReportId);
  if (!brandReport) throw new Error("Brand report not found.");
  const statuses = brandReport.providerRuns.map(run => run.status);
  if (statuses.some(status => status === "RUNNING" || status === "PENDING")) {
    await prisma.brandReport.update({ where: { id: brandReportId }, data: { automationStatus: "FETCHING" } });
    return { readyForAnalysis: false, done: false };
  }
  if (statuses.some(status => status === "PROCESSING")) {
    await prisma.brandReport.update({ where: { id: brandReportId }, data: { automationStatus: "CAPTURING" } });
    return { readyForAnalysis: false, done: false };
  }
  return { readyForAnalysis: brandReport.automationStatus !== "READY", done: brandReport.automationStatus === "READY" };
}

function normalizedEvidenceText(item: AdEvidence) {
  return `${item.headline ?? ""} ${item.body ?? ""} ${item.description ?? ""} ${item.cta ?? ""} ${item.landingPageUrl ?? ""}`
    .toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9%€$]+/g, " ").replace(/\s+/g, " ").trim();
}

async function perceptualHash(buffer: Buffer) {
  const pixels = await sharp(buffer).resize(8, 8, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const channelAverage = [0, 1, 2].map(channel => {
    let sum = 0;
    for (let index = channel; index < pixels.length; index += 3) sum += pixels[index];
    return Math.round(sum / (pixels.length / 3));
  });
  const luminance: number[] = [];
  for (let index = 0; index < pixels.length; index += 3) luminance.push(pixels[index] * .299 + pixels[index + 1] * .587 + pixels[index + 2] * .114);
  const average = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  let bits = "";
  for (const value of luminance) bits += value >= average ? "1" : "0";
  const color = channelAverage.map(value => value.toString(16).padStart(2, "0")).join("");
  return `${color}${BigInt(`0b${bits}`).toString(16).padStart(16, "0")}`;
}

function hammingDistance(left: string, right: string) {
  const leftColor = [0, 2, 4].map(index => Number.parseInt(left.slice(index, index + 2), 16));
  const rightColor = [0, 2, 4].map(index => Number.parseInt(right.slice(index, index + 2), 16));
  const colorDistance = Math.sqrt(leftColor.reduce((sum, value, index) => sum + (value - rightColor[index]) ** 2, 0));
  if (colorDistance > 45) return Number.POSITIVE_INFINITY;
  let value = BigInt(`0x${left.slice(6)}`) ^ BigInt(`0x${right.slice(6)}`);
  let count = 0;
  while (value) { count++; value &= value - BigInt(1); }
  return count;
}

function textSimilarity(left: string, right: string) {
  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

export async function groupAndSelectEvidence(brandReportId: string) {
  const evidence = await prisma.adEvidence.findMany({ where: { brandReportId }, orderBy: [{ source: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  const prepared: Array<AdEvidence & { imageHash: string | null; imageDigest: string | null; text: string; textHash: string }> = [];
  for (const item of evidence) {
    const itemText = normalizedEvidenceText(item);
    const textHash = crypto.createHash("sha256").update(itemText).digest("hex");
    let imageHash = item.perceptualHash;
    let imageDigest: string | null = null;
    if (item.localImagePath) {
      try {
        const buffer = await downloadFile(item.localImagePath);
        imageHash ||= await perceptualHash(buffer);
        imageDigest = crypto.createHash("sha256").update(buffer).digest("hex");
      } catch { imageHash = null; }
    }
    prepared.push({ ...item, imageHash, imageDigest, text: itemText, textHash });
  }
  const parents = prepared.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const union = (left: number, right: number) => { const a = find(left), b = find(right); if (a !== b) parents[b] = a; };
  for (let left = 0; left < prepared.length; left++) {
    for (let right = left + 1; right < prepared.length; right++) {
      const a = prepared[left], b = prepared[right];
      if (a.source !== b.source) continue;
      const semanticSimilarity = textSimilarity(a.text, b.text);
      const sameImage = Boolean(a.imageDigest && a.imageDigest === b.imageDigest);
      const nearImage = Boolean(a.imageHash && b.imageHash && hammingDistance(a.imageHash, b.imageHash) <= 8 && (!a.text || !b.text || semanticSimilarity >= .35));
      const similarCopy = Boolean(a.text && a.textHash === b.textHash) || (a.text.split(" ").length >= 3 && b.text.split(" ").length >= 3 && semanticSimilarity >= .8);
      const sameLandingPage = Boolean(a.landingPageUrl && a.landingPageUrl === b.landingPageUrl && semanticSimilarity >= .55);
      if (sameImage || nearImage || similarCopy || sameLandingPage) union(left, right);
    }
  }
  const groups = new Map<number, number[]>();
  for (let index = 0; index < prepared.length; index++) { const root = find(index); groups.set(root, [...(groups.get(root) ?? []), index]); }
  const updates = prepared.map((item, index) => {
    const members = groups.get(find(index))!;
    const canonical = prepared[members[0]];
    const score = (item.localImagePath ? 50 : 0) + Math.log2(members.length + 1) * 12 +
      (item.headline ? 10 : 0) + (item.body ? 8 : 0) + (item.description ? 4 : 0) +
      (item.cta ? 3 : 0) + (item.lastShown ? 5 : 0) + (item.format ? 2 : 0);
    return { item, groupKey: `${item.source}:${canonical.id}`, groupCount: members.length, score, imageHash: item.imageHash, textHash: item.textHash };
  });
  if (updates.length) await prisma.$transaction(updates.map(update => prisma.adEvidence.update({
    where: { id: update.item.id },
    data: { perceptualHash: update.imageHash, normalizedTextHash: update.textHash, duplicateGroupKey: update.groupKey, duplicateGroupCount: update.groupCount, representativeScore: update.score, selectedForSlide: false, selectedForAnalysisEvidence: false },
  })));
  const representatives = updates.filter(update => update.item.localImagePath)
    .sort((a, b) => b.score - a.score || a.item.sortOrder - b.item.sortOrder)
    .filter((update, index, all) => all.findIndex(candidate => candidate.groupKey === update.groupKey) === index);
  const google = representatives.filter(item => item.item.source === "GOOGLE").slice(0, 8);
  const meta = representatives.filter(item => item.item.source === "META").slice(0, 8);
  const slideRepresentatives = [...google, ...meta];
  const analysis: typeof slideRepresentatives = [];
  for (const source of ["GOOGLE", "META"] as const) { const strongest = slideRepresentatives.find(item => item.item.source === source); if (strongest) analysis.push(strongest); }
  for (const item of [...slideRepresentatives].sort((a, b) => b.score - a.score)) {
    if (analysis.length >= 3) break;
    if (!analysis.some(selected => selected.item.id === item.item.id)) analysis.push(item);
  }
  if (slideRepresentatives.length) await prisma.adEvidence.updateMany({ where: { id: { in: slideRepresentatives.map(item => item.item.id) } }, data: { selectedForSlide: true } });
  if (analysis.length) await prisma.adEvidence.updateMany({ where: { id: { in: analysis.map(item => item.item.id) } }, data: { selectedForAnalysisEvidence: true } });
  const selectedIds = new Set(slideRepresentatives.map(item => item.item.id));
  const selectedPaths = new Set(slideRepresentatives.map(item => item.item.localImagePath).filter((path): path is string => Boolean(path)));
  const unused = await prisma.adEvidence.findMany({
    where: { brandReportId, externalId: { not: null }, localImagePath: { not: null }, id: { notIn: [...selectedIds] } },
    include: { media: true },
  });
  for (const item of unused) {
    const paths = [...new Set([item.localImagePath, ...item.media.map(media => media.storagePath)]
      .filter((path): path is string => typeof path === "string" && !selectedPaths.has(path)))];
    const deletion = await Promise.allSettled(paths.map(path => deleteFile(path)));
    const deleted = paths.filter((_, index) => deletion[index].status === "fulfilled");
    if (!deleted.length) continue;
    await prisma.$transaction([
      prisma.adEvidence.update({
        where: { id: item.id },
        data: { localImagePath: null, storedMediaBytes: null, captureStatus: "PENDING", captureError: null },
      }),
      prisma.adMedia.updateMany({
        where: { adEvidenceId: item.id, storagePath: { in: deleted } },
        data: { storagePath: null, byteSize: null, status: "DISCARDED", error: "Removed after final representative selection." },
      }),
    ]);
  }
  await Promise.all([
    prisma.adProviderRun.updateMany({ where: { brandReportId, source: "GOOGLE" }, data: { mediaStoredCount: google.length } }),
    prisma.adProviderRun.updateMany({ where: { brandReportId, source: "META" }, data: { mediaStoredCount: meta.length } }),
  ]);
  return { google: google.length, meta: meta.length, analysis: analysis.length };
}

export async function claimBrandAnalysis(brandReportId: string) {
  const stale = new Date(Date.now() - 5 * 60_000);
  const claimed = await prisma.brandReport.updateMany({
    where: {
      id: brandReportId,
      OR: [
        { automationStatus: { in: ["PENDING", "FETCHING", "CAPTURING", "FAILED"] } },
        { automationStatus: "ANALYSING", updatedAt: { lt: stale } },
      ],
    },
    data: { automationStatus: "ANALYSING", automationError: null },
  });
  return claimed.count > 0;
}

export async function markBrandAutomationReady(brandReportId: string) {
  await prisma.brandReport.update({ where: { id: brandReportId }, data: { automationStatus: "READY", automationError: null, automationEndedAt: new Date() } });
}

export async function markBrandAutomationFailed(brandReportId: string, error: unknown) {
  const message = errorMessage(error);
  await prisma.brandReport.update({ where: { id: brandReportId }, data: { automationStatus: "FAILED", automationError: message, automationEndedAt: new Date() } }).catch(() => undefined);
  return message;
}
