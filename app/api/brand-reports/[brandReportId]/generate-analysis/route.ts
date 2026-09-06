import OpenAI from "openai";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { analysisJsonSchema, analysisSchema, normalizeAnalysisResponse } from "@/lib/analysis";
import { getCroppedImageBuffer } from "@/lib/uploads";
import { refreshBrandMediaWarnings } from "@/lib/media-status";
import { earlierReportDate } from "@/lib/month-comparison";
import { openAIModel } from "@/lib/env";

export const runtime = "nodejs";

const selected = { OR: [{ selectedForSlide: true }, { selectedForAnalysisEvidence: true }] };
type InputEvidence = {
  id: string;
  externalId: string | null;
  source: "GOOGLE" | "META";
  headline: string | null;
  body: string | null;
  description: string | null;
  cta: string | null;
  landingPageUrl: string | null;
  platform: string | null;
  format: string | null;
  notes: string | null;
  firstShown: Date | null;
  lastShown: Date | null;
  localImagePath: string | null;
  cropX: number | null;
  cropY: number | null;
  cropWidth: number | null;
  cropHeight: number | null;
  reachLower: number | null;
  reachUpper: number | null;
  duplicateGroupKey: string | null;
  duplicateGroupCount: number;
  perceptualHash: string | null;
  normalizedTextHash: string | null;
  representativeScore: number | null;
  selectedForSlide: boolean;
  selectedForAnalysisEvidence: boolean;
  rawData: unknown;
};

const date = (value: Date | null) => value ? value.toISOString().slice(0, 10) : "not recorded";

function labels(items: InputEvidence[], previous = false) {
  const map = new Map<string, string>();
  let google = 0;
  let meta = 0;
  for (const item of items) map.set(item.id, `${previous ? "P" : ""}${item.source === "GOOGLE" ? `G${++google}` : `M${++meta}`}`);
  return map;
}

function evidenceText(items: InputEvidence[], map: Map<string, string>, previous = false) {
  return items.map(item =>
    `${previous ? "PREVIOUS " : ""}[${map.get(item.id)}] | ${item.source} | creative ID: ${item.externalId ?? "manual"} | headline: ${item.headline ?? "—"} | body: ${item.body ?? "—"} | description: ${item.description ?? "—"} | CTA: ${item.cta ?? "—"} | landing page: ${item.landingPageUrl ?? "—"} | platform: ${item.platform ?? "—"} | first shown: ${date(item.firstShown)} | last shown: ${date(item.lastShown)} | related ads in group: ${item.duplicateGroupCount} | reach range: ${item.reachLower ?? "—"}–${item.reachUpper ?? "—"} | perceptual hash: ${item.perceptualHash ?? "—"}`
  ).join("\n");
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstRawValue(rawData: unknown, keys: string[]) {
  const data = object(rawData);
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" || typeof value === "number") return String(value);
  }
  return "—";
}

function previousAnalysisText(raw: string | null) {
  if (!raw) return "No retained AI analysis.";
  try {
    const parsed = object(JSON.parse(raw));
    const fields = ["keyThemes", "modelsPromoted", "offers", "googleFindings", "socialFindings", "changesVsPreviousMonth"];
    const concise: Record<string, unknown> = Object.fromEntries(fields.flatMap(field => {
      const value = parsed[field];
      if (!Array.isArray(value)) return [];
      return [[field, value.flatMap(item => {
        const finding = object(item);
        if (typeof finding.text !== "string") return [];
        return [{ text: finding.text, ...(typeof finding.classification === "string" ? { classification: finding.classification } : {}) }];
      })]];
    }));
    const conclusion = object(parsed.conclusion);
    if (typeof conclusion.text === "string") concise.conclusion = conclusion.text;
    return JSON.stringify(concise);
  } catch {
    return raw.slice(0, 6_000);
  }
}

function comparisonEvidence(items: InputEvidence[]) {
  const selectedItems = items.filter(item => item.selectedForSlide || item.selectedForAnalysisEvidence);
  const selectedIds = new Set(selectedItems.map(item => item.id));
  const seenGroups = new Set(selectedItems.map(item => item.duplicateGroupKey || `${item.source}:${item.externalId || item.id}`));
  const additional = [...items]
    .filter(item => !selectedIds.has(item.id))
    .sort((a, b) => (b.representativeScore ?? 0) - (a.representativeScore ?? 0))
    .filter(item => {
      const group = item.duplicateGroupKey || `${item.source}:${item.externalId || item.id}`;
      if (seenGroups.has(group)) return false;
      seenGroups.add(group);
      return true;
    });
  const bySource = (source: InputEvidence["source"]) => [
    ...selectedItems.filter(item => item.source === source),
    ...additional.filter(item => item.source === source),
  ].slice(0, 24);
  return [...bySource("GOOGLE"), ...bySource("META")];
}

function previousMetadataText(allItems: InputEvidence[], represented: InputEvidence[], map: Map<string, string>) {
  const counts = { GOOGLE: 0, META: 0 };
  const ids = { GOOGLE: [] as string[], META: [] as string[] };
  for (const item of allItems) {
    counts[item.source]++;
    if (item.externalId && !ids[item.source].includes(item.externalId)) ids[item.source].push(item.externalId);
  }
  const idSummary = (["GOOGLE", "META"] as const).map(source => {
    const shown = ids[source].slice(0, 120);
    return `${source}: ${counts[source]} ads; source ad IDs: ${shown.join(", ") || "none"}${ids[source].length > shown.length ? `; +${ids[source].length - shown.length} more retained IDs` : ""}`;
  }).join("\n");
  const rows = represented.map(item => {
    const campaign = firstRawValue(item.rawData, ["campaignName", "campaign_name", "campaignId", "campaign_id"]);
    const group = firstRawValue(item.rawData, ["adSetName", "adset_name", "adSetId", "adset_id", "groupName", "group_name", "groupId", "group_id"]);
    return `[${map.get(item.id)}] ${item.source} | source ID: ${item.externalId ?? "manual"} | campaign: ${campaign} | campaign/group classification: ${group} / ${item.duplicateGroupKey ?? "ungrouped"} | related ads: ${item.duplicateGroupCount} | headline: ${item.headline ?? "—"} | body: ${item.body ?? "—"} | description: ${item.description ?? "—"} | CTA: ${item.cta ?? "—"} | landing page: ${item.landingPageUrl ?? "—"} | platform/format: ${item.platform ?? "—"} / ${item.format ?? "—"} | notes: ${item.notes ?? "—"} | first shown: ${date(item.firstShown)} | last shown: ${date(item.lastShown)} | reach range: ${item.reachLower ?? "—"}–${item.reachUpper ?? "—"} | text hash: ${item.normalizedTextHash ?? "—"}`;
  }).join("\n");
  return `${idSummary}\nRepresentative retained metadata and classifications:\n${rows || "No retained ad metadata."}`;
}

async function imagePart(item: InputEvidence, label: string) {
  if (!item.localImagePath) {
    throw new Error(`Selected evidence [${label}] does not have an uploaded screenshot.`);
  }
  try {
    const crop = item.cropX !== null && item.cropY !== null && item.cropWidth !== null && item.cropHeight !== null
      ? { cropX: item.cropX, cropY: item.cropY, cropWidth: item.cropWidth, cropHeight: item.cropHeight }
      : null;
    const buffer = await getCroppedImageBuffer(item.localImagePath, crop);
    const meta = await sharp(buffer).metadata();
    return {
      type: "input_image" as const,
      image_url: `data:image/${meta.format === "jpeg" ? "jpeg" : meta.format ?? "png"};base64,${buffer.toString("base64")}`,
      detail: "high" as const,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown image error";
    throw new Error(`Selected evidence [${label}] could not be read from storage: ${detail}`);
  }
}

function logAnalysisError(brandReportId: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") {
    console.error(`Analysis generation failed for BrandReport ${brandReportId}.`, error);
  }
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ brandReportId: string }> }) {
  const { brandReportId } = await params;
  try {
    const current = await prisma.brandReport.findUnique({
      where: { id: brandReportId },
      include: {
        brand: true,
        report: true,
        adEvidence: {
          where: selected,
          orderBy: [{ source: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });
    if (!current) return Response.json({ error: "Brand report not found." }, { status: 404 });
    if (!current.adEvidence.length) {
      return Response.json(
        { error: "No evidence selected. Select Google or Social evidence before generating analysis." },
        { status: 400 },
      );
    }
    await refreshBrandMediaWarnings(brandReportId);

    const analysisEvidenceCount = current.adEvidence.filter(item => item.selectedForAnalysisEvidence).length;
    if (analysisEvidenceCount > 3) {
      return Response.json({ error: "Reduce selected analysis evidence to a maximum of 3 before generating analysis." }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Analysis is unavailable: OPENAI_API_KEY is not configured." }, { status: 503 });
    }

    const prior = await prisma.brandReport.findFirst({
      where: {
        brandId: current.brandId,
        included: true,
        report: {
          status: "COMPLETE",
          ...earlierReportDate(current.report.year, current.report.month),
        },
      },
      orderBy: [{ report: { year: "desc" } }, { report: { month: "desc" } }],
      include: {
        report: true,
        adEvidence: {
          orderBy: [{ source: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    await prisma.brandReport.update({
      where: { id: brandReportId },
      data: { previousBrandReportId: prior?.id ?? null },
    });

    const currentEvidence = current.adEvidence as InputEvidence[];
    const currentLabels = labels(currentEvidence);
    const priorAllEvidence = (prior?.adEvidence ?? []) as InputEvidence[];
    const priorEvidence = comparisonEvidence(priorAllEvidence);
    const priorLabels = labels(priorEvidence, true);
    const languageInstructions = current.report.language === "HR"
      ? "Write ALL prose in natural, professional Croatian using correct Croatian characters (č, ć, ž, š, đ). Use appropriate automotive and marketing terminology. Preserve brand names, model names, campaign slogans, and evidence identifiers exactly; do not mechanically translate them."
      : "Write ALL prose in concise, professional English.";
    const instructions = `You analyse only supplied competitor-advertising evidence for ${current.brand.name}. ${languageInstructions} Never make factual claims unless supported by supplied evidence. Every non-empty finding must cite one or more evidence identifiers such as [G1], [M1], [PG1], or [PM1]. In the JSON evidence arrays, return identifiers without brackets. Use G/M for current evidence and PG/PM for previous evidence. Each evidence array MUST contain no more than 8 unique evidence IDs. Use only evidence IDs supplied in this request. Prefer the smallest number of citations necessary to support the finding. The conclusion must use no more than 8 evidence references. Never infer spend, sales, ROI, reach, performance, campaign success, or a change in spend/performance unless actual supplied data directly measures it. Do not interpret duration as proof that an ad converts. Produce concise, PowerPoint-ready content. Each bullet should be one short sentence. Use at most 3 keyThemes, 4 modelsPromoted, 3 offers, 3 googleFindings, 3 socialFindings, and 3 changesVsPreviousMonth. The conclusion must contain at most 2 short sentences. Avoid repeating the same model, offer, or observation in multiple sections unless analytically necessary. Consider creative IDs, hashes, group counts, campaign/group classifications, offers, models, text, and current screenshots. Previous screenshots are intentionally unavailable and are never required. If no prior report is supplied, changesVsPreviousMonth MUST be []. If a prior report is supplied, each changesVsPreviousMonth item must set classification to exactly NEW, CONTINUING, NO LONGER OBSERVED, INCREASED PRESENCE, or DECREASED PRESENCE. Use INCREASED PRESENCE or DECREASED PRESENCE only when the supplied group counts or occurrence counts support that comparison. Support comparison findings with current and/or previous evidence identifiers appropriate to the claim; a NO LONGER OBSERVED finding can rely on previous evidence plus the supplied current-month set. Return empty arrays where the evidence does not support a finding.`;
    const content: Array<
      { type: "input_text"; text: string } |
      { type: "input_image"; image_url: string; detail: "high" }
    > = [{
      type: "input_text",
      text: `${instructions}\n\nREPORT LANGUAGE: ${current.report.language}\nCURRENT REPORT: ${current.report.month}/${current.report.year}\nCURRENT EVIDENCE:\n${evidenceText(currentEvidence, currentLabels)}${prior ? `\n\nPREVIOUS REPORT: ${prior.report.month}/${prior.report.year}\nPREVIOUS RETAINED AI ANALYSIS:\n${previousAnalysisText(prior.analysisEditedJson || prior.analysisJson)}\n\nPREVIOUS RETAINED STRUCTURED DATA:\n${previousMetadataText(priorAllEvidence, priorEvidence, priorLabels)}` : "\n\nNO PREVIOUS COMPLETED REPORT IS AVAILABLE."}`,
    }];

    for (const item of currentEvidence) {
      const label = currentLabels.get(item.id)!;
      if (item.localImagePath) {
        content.push({ type: "input_text", text: `Current screenshot for [${label}]:` });
        content.push(await imagePart(item, label));
      }
    }
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.responses.create({
      model: openAIModel(),
      store: false,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "brand_advertising_analysis",
          strict: true,
          schema: analysisJsonSchema,
        },
      },
    });
    const validLabels = new Set([...currentLabels.values(), ...priorLabels.values()]);
    const rawAnalysis = JSON.parse(response.output_text) as unknown;
    const normalized = normalizeAnalysisResponse(rawAnalysis, validLabels, message => {
      if (process.env.NODE_ENV !== "production") console.info(message);
    });
    const parsed = analysisSchema.parse(normalized);

    await prisma.brandReport.update({
      where: { id: brandReportId },
      data: { analysisJson: JSON.stringify(parsed), analysisEditedJson: null, automationStatus: "READY", automationError: null, automationEndedAt: new Date() },
    });
    const remaining = await prisma.brandReport.count({
      where: { reportId: current.reportId, included: true, automationStatus: { not: "READY" } },
    });
    if (!remaining) await prisma.report.update({ where: { id: current.reportId }, data: { status: "COMPLETE" } });
    return Response.json(parsed);
  } catch (error) {
    logAnalysisError(brandReportId, error);
    const detail = error instanceof Error ? error.message : "Unknown analysis error.";
    return Response.json({ error: `Analysis could not be generated: ${detail}` }, { status: 502 });
  }
}
