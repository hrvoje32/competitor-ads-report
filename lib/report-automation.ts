import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AdEvidence, AdProviderRun, Prisma } from "@prisma/client";
import sharp from "sharp";
import { apifyError, getApifyDatasetItems, getApifyRun, startApifyActor } from "@/lib/ad-providers/apify";
import { collectGoogleOfficial } from "@/lib/ad-providers/google/official";
import { collectMetaOfficial } from "@/lib/ad-providers/meta/official";
import { previousProviders, type ProviderSelection } from "@/lib/ad-providers/selection";
import { captureOfficialCandidate } from "@/lib/official-capture";
import { refreshBrandEvidence } from "@/lib/brand-evidence";
import { filterBrandAd, hasUsableScreenshot, record } from "@/lib/brand-ad-filter";
import { captureBudgetOpen, nextCaptureCandidate } from "@/lib/official-capture-policy";
import { googleApifyProvider, normalizeGoogleApifyAd } from "@/lib/ad-providers/google/apify";
import { metaApifyProvider, normalizeMetaApifyAd } from "@/lib/ad-providers/meta/apify";
import type { AdProviderSource, CollectionRequest, NormalizedAd } from "@/lib/ad-providers/types";
import { processApifyMedia } from "@/lib/apify-media";
import { rankedApifyCandidates } from "@/lib/apify-selection";
import { MAX_APIFY_CANDIDATES_PER_SOURCE, MAX_REPORT_CREATIVES_PER_SOURCE } from "@/lib/ad-evidence-limits";
import { prisma } from "@/lib/prisma";
import { deliveryOverlapsAnalysisPeriod, isoReportDate } from "@/lib/report-period";
import { downloadFile } from "@/lib/storage";

const TERMINAL_APIFY_STATUSES = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

type LoadedBrandReport = Awaited<ReturnType<typeof loadBrandReport>>;

function errorMessage(error: unknown) {
  let message = error instanceof Error ? error.message : "Unknown automation error.";
  for (const token of [process.env.APIFY_TOKEN, process.env.META_ACCESS_TOKEN]) {
    if (token) message = message.split(token).join("[redacted]").split(encodeURIComponent(token)).join("[redacted]");
  }
  return message;
}

async function loadBrandReport(brandReportId: string) {
  return prisma.brandReport.findUnique({
    where: { id: brandReportId },
    include: {
      brand: { include: { metaPages: true, googleAdvertisers: true } },
      report: true,
      providerRuns: true,
    },
  });
}

function collectionRequest(brandReport: NonNullable<LoadedBrandReport>): CollectionRequest {
  return {
    brandName: brandReport.brand.name,
    googleDomain: brandReport.brand.googleDomain,
    googleAdvertiserIds: brandReport.brand.googleAdvertisers.map(item => item.advertiserId),
    metaPageIds: brandReport.brand.metaPages.map(item => item.pageId),
    countryCode: brandReport.report.countryCode,
    startDate: isoReportDate(brandReport.report.startDate),
    endDate: isoReportDate(brandReport.report.endDate),
    maxResults: MAX_APIFY_CANDIDATES_PER_SOURCE,
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

async function startSource(brandReport: NonNullable<LoadedBrandReport>, source: AdProviderSource, selection: ProviderSelection) {
  if (selection[source] === "OFFICIAL") {
    const actorId = source === "GOOGLE" ? "google-bigquery" : "meta-ad-library-api";
    const data = {
      provider: "OFFICIAL", actorId, inputJson: json({ ...collectionRequest(brandReport) }),
      runId: null, datasetId: null, status: "RUNNING" as const, error: null,
      itemCount: 0, mediaStoredCount: 0, itemsPersistedAt: null, processingStartedAt: null,
      startedAt: new Date(), completedAt: null,
    };
    await prisma.adProviderRun.upsert({
      where: { brandReportId_source: { brandReportId: brandReport.id, source } },
      create: { brandReportId: brandReport.id, source, ...data }, update: data,
    });
    await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(source, "FETCHING") });
    return { source, started: true };
  }
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
      update: { provider: "APIFY", actorId, runId: null, datasetId: null, status: "FAILED", error: message, completedAt: new Date(), itemsPersistedAt: null },
    });
    await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(source, "FAILED", message) });
    return { source, started: false, error: message };
  }

  const previous = brandReport.providerRuns.find(run => run.source === source);
  const previousInput = previous?.inputJson && typeof previous.inputJson === "object" && !Array.isArray(previous.inputJson)
    ? { ...previous.inputJson, [source === "GOOGLE" ? "maxAds" : "maxResults"]: MAX_APIFY_CANDIDATES_PER_SOURCE } : null;
  if (previous?.provider === "APIFY" && previous.itemsPersistedAt && previous.datasetId
    && previous.actorId === provider.actorId && isDeepStrictEqual(previousInput, provider.input)) {
    await refreshBrandEvidence(brandReport.id);
    await prisma.adProviderRun.update({ where: { id: previous.id }, data: { status: "PROCESSING", processingStartedAt: null, error: null, completedAt: null } });
    await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(source, "CAPTURING") });
    return { source, started: false, reused: true };
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

export async function startBrandAutomation(brandReportId: string, options: { failedOnly?: boolean; providers?: ProviderSelection } = {}) {
  const brandReport = await loadBrandReport(brandReportId);
  if (!brandReport) throw new Error("Brand report not found.");
  const providers = options.providers ?? previousProviders(brandReport.providerRuns);
  const failedSources = (["GOOGLE", "META"] as const).filter(source =>
    source === "GOOGLE" ? brandReport.googleStatus === "FAILED" : brandReport.metaStatus === "FAILED"
  );
  const sources = options.failedOnly ? failedSources : (["GOOGLE", "META"] as const);
  const claimed = await prisma.brandReport.updateMany({
    where: { id: brandReportId, automationStatus: { notIn: ["FETCHING", "CAPTURING", "ANALYSING"] } },
    data: {
      automationStatus: sources.length ? "FETCHING" : "CAPTURING",
      ...(sources.includes("GOOGLE") ? sourceStatusData("GOOGLE", "PENDING") : {}),
      ...(sources.includes("META") ? sourceStatusData("META", "PENDING") : {}),
      automationError: null,
      googleMediaError: null,
      metaMediaError: null,
      automationStartedAt: new Date(),
      automationEndedAt: null,
    },
  });
  if (!claimed.count) throw new Error("Collection is already running for this brand. Wait for it to finish before switching sources.");
  await prisma.report.update({ where: { id: brandReport.reportId }, data: { mediaCleanedAt: null } });
  const results = await Promise.all(sources.map(source => startSource(brandReport, source, providers)));
  return { brandReportId, results };
}

function json(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function usefulRawData(item: NormalizedAd) {
  const raw = item.rawData ?? {};
  const fields = [
    "campaignId", "campaign_id", "adSetId", "adset_id", "groupId", "group_id",
    "advertiser_disclosed_name", "advertiser_legal_name", "advertiser_location", "ad_funded_by", "page_id", "page_name", "ad_creative_bodies", "ad_creative_link_titles", "ad_creative_link_descriptions", "ad_creative_link_captions", "campaignName", "campaign_name", "destination_url", "displayUrl", "display_url", "currency", "languages", "publisherPlatforms", "publisher_platforms", "topic", "fundedBy",
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

async function persistNormalizedAds(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun, items: NormalizedAd[]) {
  const request = collectionRequest(brandReport);
  const ads = items.filter(item => dateOverlaps(item, request))
    .filter((item, index, all) => all.findIndex(candidate => candidate.externalId === item.externalId) === index);

  // Merge by source ad ID. A failed/empty official response must never erase existing evidence.
  for (const [index, item] of ads.entries()) {
    const metadata = {
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
      reachLower: item.reachLower,
      reachUpper: item.reachUpper,
    };
    const existing = await prisma.adEvidence.findFirst({ where: { brandReportId: brandReport.id, source: item.source, externalId: item.externalId }, select: { rawData: true } });
    const mediaDigest = record(existing?.rawData).apifyMediaDigest;
    const rawData = json({ ...usefulRawData(item), ...(typeof mediaDigest === "string" ? { apifyMediaDigest: mediaDigest } : {}), collectionProvider: run.provider, ...(run.provider === "APIFY" ? { apifyDatasetId: run.datasetId } : {}) });
    const evidence = await prisma.adEvidence.upsert({
      where: { brandReportId_source_externalId: { brandReportId: brandReport.id, source: item.source, externalId: item.externalId } },
      create: {
        brandReportId: brandReport.id, source: item.source, externalId: item.externalId,
        ...metadata, rawData,
        notes: JSON.stringify({ importedFrom: run.provider.toLowerCase(), actorId: run.actorId, advertiserId: item.advertiserId, advertiserName: item.advertiserName, videoUrls: item.videoUrls }),
        sortOrder: index, captureStatus: "PENDING",
      },
      update: { ...metadata, rawData },
    });
    if (!evidence.localImagePath && (run.provider !== "OFFICIAL" || !evidence.officialCaptureAttemptedAt)) {
      await prisma.adEvidence.update({ where: { id: evidence.id }, data: { captureStatus: "PENDING", captureError: null } });
      await prisma.adMedia.updateMany({ where: { adEvidenceId: evidence.id, status: { in: ["FAILED", "DISCARDED"] } }, data: { status: "PENDING", error: null } });
    }
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
  await refreshBrandEvidence(brandReport.id);
  await prepareEvidenceMetadata(brandReport.id, run.source);
  await prisma.adProviderRun.update({
    where: { id: run.id },
    data: { itemCount: ads.length, itemsPersistedAt: new Date(), processingStartedAt: null },
  });
}

async function processOfficialMediaBatch(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  const claimed = await prisma.adProviderRun.updateMany({
    where: { id: run.id, status: "PROCESSING", itemsPersistedAt: { not: null }, OR: [
      { processingStartedAt: null },
      { processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
    ] },
    data: { processingStartedAt: new Date() },
  });
  if (!claimed.count) return;
  try {
    await captureOfficialMedia(brandReport, run);
  } finally {
    await prisma.adProviderRun.update({ where: { id: run.id }, data: { processingStartedAt: null } });
  }
}

async function captureOfficialMedia(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  await captureOfficialCandidate(brandReport.id, run.source);
}

async function processMediaBatch(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  if (run.provider === "OFFICIAL") return processOfficialMediaBatch(brandReport, run);
  return processApifyMedia(brandReport, run);
}

async function finishProviderIfReady(brandReport: NonNullable<LoadedBrandReport>, run: AdProviderRun) {
  const pendingMedia = await prisma.adMedia.count({
    where: { status: { in: ["PENDING", "DOWNLOADING"] }, adEvidence: { brandReportId: brandReport.id, source: run.source, brandFilterStatus: "INCLUDED" } },
  });
  if (run.provider === "OFFICIAL") {
    const where = { brandReportId: brandReport.id, source: run.source };
    const state = await prisma.officialCaptureState.findUnique({ where: { brandReportId_source: where } });
    if (state?.leaseToken) return;
    const evidence = await prisma.adEvidence.findMany({ where });
    const stored = evidence.filter(hasUsableScreenshot).length;
    if (!(process.env.VERCEL && !process.env.BROWSER_WS_ENDPOINT)
      && captureBudgetOpen(state?.attempts ?? 0, stored)
      && nextCaptureCandidate(evidence, state?.attempts ?? 0, stored)) return;
  } else {
    const currentRun = await prisma.adProviderRun.findUniqueOrThrow({ where: { id: run.id } });
    if (currentRun.processingStartedAt) return;
    const evidence = await prisma.adEvidence.findMany({ where: { brandReportId: brandReport.id, source: run.source } });
    const ranked = rankedApifyCandidates(evidence.map(item => ({ ...item, ...filterBrandAd(item, brandReport.brand) })), run.datasetId);
    if (ranked.filter(hasUsableScreenshot).length < MAX_REPORT_CREATIVES_PER_SOURCE
      && ranked.some(item => !item.localImagePath && item.captureStatus !== "CAPTURE_FAILED")) return;
    if (pendingMedia) return;
  }
  const [stored, failedDownloads, missingMedia] = await Promise.all([
    prisma.adEvidence.count({ where: { brandReportId: brandReport.id, source: run.source, brandFilterStatus: "INCLUDED", selectedForSlide: true, localImagePath: { not: null } } }),
    prisma.adMedia.count({ where: { status: "FAILED", adEvidence: { brandReportId: brandReport.id, source: run.source, brandFilterStatus: "INCLUDED" } } }),
    prisma.adEvidence.count({ where: { brandReportId: brandReport.id, source: run.source, brandFilterStatus: "INCLUDED", captureStatus: "CAPTURE_FAILED" } }),
  ]);
  const label = run.source === "GOOGLE" ? "Google" : "Meta";
  const warnings = [
    failedDownloads ? `${failedDownloads} media download${failedDownloads === 1 ? "" : "s"} failed` : "",
    missingMedia ? `${missingMedia} ad${missingMedia === 1 ? "" : "s"} need a screenshot; open the creative and upload one or retry capture` : "",
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
  if (run.provider === "OFFICIAL" && !run.itemsPersistedAt) {
    if (!["RUNNING", "PROCESSING"].includes(run.status)) return;
    const claimed = await prisma.adProviderRun.updateMany({
      where: { id: run.id, itemsPersistedAt: null, OR: [
        { status: "RUNNING" },
        { status: "PROCESSING", processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      ] },
      data: { status: "PROCESSING", processingStartedAt: new Date() },
    });
    if (!claimed.count) return;
    try {
      const request = collectionRequest(brandReport);
      const items = run.source === "GOOGLE"
        ? await collectGoogleOfficial(request.googleAdvertiserIds ?? [], request.countryCode, request.startDate, request.endDate)
        : await collectMetaOfficial(request.metaPageIds, request.countryCode, request.startDate, request.endDate);
      await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(run.source, "CAPTURING") });
      await persistNormalizedAds(brandReport, run, items);
      run = await prisma.adProviderRun.findUniqueOrThrow({ where: { id: run.id } });
    } catch (error) {
      return failProvider(brandReport.id, run.source, errorMessage(error));
    }
  }
  if (run.status === "RUNNING") {
    if (!run.runId) return failProvider(brandReport.id, run.source, "Apify run ID is missing.");
    try {
      const remote = await getApifyRun(run.runId);
      if (!TERMINAL_APIFY_STATUSES.has(remote.status)) return;
      if (remote.status !== "SUCCEEDED") return failProvider(brandReport.id, run.source, `Apify Actor run ended with status ${remote.status}.`);
      if (!remote.datasetId) return failProvider(brandReport.id, run.source, "Apify Actor completed without a dataset.");
      const claimed = await prisma.adProviderRun.updateMany({
        where: { id: run.id, status: "RUNNING" },
        data: { datasetId: remote.datasetId, status: "PROCESSING", processingStartedAt: null, error: null },
      });
      if (!claimed.count) return;
      run = await prisma.adProviderRun.findUniqueOrThrow({ where: { id: run.id } });
      await prisma.brandReport.update({ where: { id: brandReport.id }, data: sourceStatusData(run.source, "CAPTURING") });
    } catch (error) {
      return failProvider(brandReport.id, run.source, apifyError(error));
    }
  }
  if (run.status !== "PROCESSING") return;
  try {
    if (!run.itemsPersistedAt) {
      if (!run.datasetId) throw new Error("Apify dataset ID is missing.");
      const claimed = await prisma.adProviderRun.updateMany({ where: { id: run.id, status: "PROCESSING", itemsPersistedAt: null,
        OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } }] },
        data: { processingStartedAt: new Date() } });
      if (!claimed.count) return;
      const rows = await getApifyDatasetItems(run.datasetId);
      const normalize = run.source === "GOOGLE" ? normalizeGoogleApifyAd : normalizeMetaApifyAd;
      await persistNormalizedAds(brandReport, run, rows.map(normalize).filter((item): item is NormalizedAd => Boolean(item)));
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
  // A poll arriving while POST initializes the runs must not finish last run's analysis.
  if (brandReport.googleStatus === "PENDING" || brandReport.metaStatus === "PENDING") {
    return { readyForAnalysis: false, done: false };
  }
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
  await refreshBrandEvidence(brandReportId);
  const report = await loadBrandReport(brandReportId);
  if (!report) throw new Error("Brand report not found.");
  const allEvidence = await prisma.adEvidence.findMany({ where: { brandReportId }, orderBy: [{ source: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  const apifySources = report.providerRuns.filter(run => run.provider === "APIFY").map(run => run.source);
  const apifySelected = apifySources.flatMap(source => rankedApifyCandidates(allEvidence.filter(item => item.source === source)
    .map(item => ({ ...item, ...filterBrandAd(item, report.brand) })), report.providerRuns.find(run => run.source === source)?.datasetId)
    .filter(hasUsableScreenshot).slice(0, MAX_REPORT_CREATIVES_PER_SOURCE));
  const evidence = allEvidence.filter(item => !apifySources.includes(item.source));
  const prepared: Array<AdEvidence & { imageHash: string | null; imageDigest: string | null; text: string; textHash: string }> = [];
  for (const item of evidence) {
    const itemText = normalizedEvidenceText(item);
    const textHash = crypto.createHash("sha256").update(itemText).digest("hex");
    let imageHash = item.perceptualHash;
    let imageDigest: string | null = null;
    if (hasUsableScreenshot(item) && filterBrandAd(item, report.brand).brandFilterStatus === "INCLUDED") {
      try {
        const buffer = await downloadFile(item.localImagePath!);
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
  const representatives: Array<{ item: AdEvidence; score: number }> = updates.filter(update => update.imageHash && hasUsableScreenshot(update.item) && filterBrandAd(update.item, report.brand).brandFilterStatus === "INCLUDED")
    .sort((a, b) => b.score - a.score || a.item.sortOrder - b.item.sortOrder)
    .filter((update, index, all) => all.findIndex(candidate => candidate.groupKey === update.groupKey) === index);
  for (const item of apifySelected) representatives.push({ item, score: item.representativeScore ?? 0 });
  for (const source of apifySources) await prisma.adEvidence.updateMany({ where: { brandReportId, source }, data: { selectedForSlide: false, selectedForAnalysisEvidence: false } });
  const google = representatives.filter(item => item.item.source === "GOOGLE").slice(0, MAX_REPORT_CREATIVES_PER_SOURCE);
  const meta = representatives.filter(item => item.item.source === "META").slice(0, MAX_REPORT_CREATIVES_PER_SOURCE);
  const slideRepresentatives = [...google, ...meta];
  const analysis: typeof slideRepresentatives = [];
  for (const source of ["GOOGLE", "META"] as const) { const strongest = slideRepresentatives.find(item => item.item.source === source); if (strongest) analysis.push(strongest); }
  for (const item of [...slideRepresentatives].sort((a, b) => b.score - a.score)) {
    if (analysis.length >= 3) break;
    if (!analysis.some(selected => selected.item.id === item.item.id)) analysis.push(item);
  }
  if (slideRepresentatives.length) await prisma.adEvidence.updateMany({ where: { id: { in: slideRepresentatives.map(item => item.item.id) } }, data: { selectedForSlide: true } });
  if (analysis.length) await prisma.adEvidence.updateMany({ where: { id: { in: analysis.map(item => item.item.id) } }, data: { selectedForAnalysisEvidence: true } });
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
