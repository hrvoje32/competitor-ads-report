import { z } from "zod";

export const analysisSectionLimits = {
  keyThemes: 3,
  modelsPromoted: 4,
  offers: 3,
  googleFindings: 3,
  socialFindings: 3,
  changesVsPreviousMonth: 3,
} as const;

const finding = z.object({ text: z.string().trim().min(1).max(1200), evidence: z.array(z.string().regex(/^(?:P)?[GM]\d+$/)).min(1).max(8) }).strict();
export const comparisonClassifications = ["NEW", "CONTINUING", "NO LONGER OBSERVED", "INCREASED PRESENCE", "DECREASED PRESENCE"] as const;
const comparisonFinding = finding.extend({ classification: z.enum(comparisonClassifications).optional() });
export const analysisSchema = z.object({
  keyThemes: z.array(finding).max(analysisSectionLimits.keyThemes),
  modelsPromoted: z.array(finding).max(analysisSectionLimits.modelsPromoted),
  offers: z.array(finding).max(analysisSectionLimits.offers),
  googleFindings: z.array(finding).max(analysisSectionLimits.googleFindings),
  socialFindings: z.array(finding).max(analysisSectionLimits.socialFindings),
  changesVsPreviousMonth: z.array(comparisonFinding).max(analysisSectionLimits.changesVsPreviousMonth),
  conclusion: finding,
}).strict();
export type Analysis = z.infer<typeof analysisSchema>;
export const emptyAnalysis: Analysis = { keyThemes: [], modelsPromoted: [], offers: [], googleFindings: [], socialFindings: [], changesVsPreviousMonth: [], conclusion: { text: "", evidence: [] } };
export const analysisJsonSchema = { type: "object", additionalProperties: false, required: ["keyThemes", "modelsPromoted", "offers", "googleFindings", "socialFindings", "changesVsPreviousMonth", "conclusion"], properties: { keyThemes: { type: "array", maxItems: analysisSectionLimits.keyThemes, items: findingSchema() }, modelsPromoted: { type: "array", maxItems: analysisSectionLimits.modelsPromoted, items: findingSchema() }, offers: { type: "array", maxItems: analysisSectionLimits.offers, items: findingSchema() }, googleFindings: { type: "array", maxItems: analysisSectionLimits.googleFindings, items: findingSchema() }, socialFindings: { type: "array", maxItems: analysisSectionLimits.socialFindings, items: findingSchema() }, changesVsPreviousMonth: { type: "array", maxItems: analysisSectionLimits.changesVsPreviousMonth, items: comparisonFindingSchema() }, conclusion: findingSchema() } };
function findingSchema() { return { type: "object", additionalProperties: false, required: ["text", "evidence"], properties: { text: { type: "string" }, evidence: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } } }; }
function comparisonFindingSchema() { return { type: "object", additionalProperties: false, required: ["classification", "text", "evidence"], properties: { classification: { type: "string", enum: [...comparisonClassifications] }, text: { type: "string" }, evidence: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } } } }; }

type NormalizationLogger = (message: string) => void;
type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

export function normalizeEvidenceReferences(value: unknown, validEvidenceIds: ReadonlySet<string>, max = 8, path = "evidence", log?: NormalizationLogger) {
  const input = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const seen = new Set<string>();
  const valid: string[] = [];
  let unknown = 0;
  let duplicates = 0;
  for (const item of input) {
    if (typeof item !== "string") { unknown++; continue; }
    const reference = item.trim().replace(/^\[|\]$/g, "").toUpperCase();
    if (!validEvidenceIds.has(reference)) { unknown++; continue; }
    if (seen.has(reference)) { duplicates++; continue; }
    seen.add(reference);
    valid.push(reference);
  }
  const output = valid.slice(0, max);
  if (valid.length > max) log?.(`[AI] ${path} truncated from ${valid.length} to ${max}`);
  if (duplicates || unknown || !Array.isArray(value)) {
    const reasons = [duplicates ? `${duplicates} duplicate${duplicates === 1 ? "" : "s"}` : "", unknown ? `${unknown} unknown/invalid` : "", !Array.isArray(value) ? "non-array input" : ""].filter(Boolean).join(", ");
    log?.(`[AI] ${path} normalized (${reasons}); ${input.length} reference${input.length === 1 ? "" : "s"} became ${output.length}`);
  }
  return output;
}

function normalizeFinding(value: unknown, validEvidenceIds: ReadonlySet<string>, path: string, log?: NormalizationLogger, comparison = false) {
  const item = record(value);
  if (!item) return null;
  const text = typeof item.text === "string" ? item.text.trim() : "";
  const evidence = normalizeEvidenceReferences(item.evidence, validEvidenceIds, 8, `${path}.evidence`, log);
  if (!text || !evidence.length) {
    log?.(`[AI] ${path} removed because it did not contain both supported text and valid evidence`);
    return null;
  }
  if (!comparison) return { text, evidence };
  const classification = typeof item.classification === "string" && comparisonClassifications.includes(item.classification as typeof comparisonClassifications[number])
    ? item.classification as typeof comparisonClassifications[number]
    : undefined;
  if (!classification) {
    log?.(`[AI] ${path} removed because it did not contain a supported comparison classification`);
    return null;
  }
  return { text, evidence, classification };
}

function normalizeFindingArray(value: unknown, validEvidenceIds: ReadonlySet<string>, path: keyof typeof analysisSectionLimits, log?: NormalizationLogger) {
  if (!Array.isArray(value)) {
    log?.(`[AI] ${path} normalized to an empty array`);
    return [];
  }
  const normalized = value.map((item, index) => normalizeFinding(item, validEvidenceIds, `${path}[${index}]`, log, path === "changesVsPreviousMonth"))
    .filter((item): item is { text: string; evidence: string[] } => Boolean(item));
  const limit = analysisSectionLimits[path];
  if (normalized.length > limit) log?.(`[AI] ${path} truncated from ${normalized.length} to ${limit} findings`);
  return normalized.slice(0, limit);
}

export function normalizeAnalysisResponse(value: unknown, validEvidenceIds: ReadonlySet<string>, log?: NormalizationLogger) {
  const input = record(value) ?? {};
  const conclusionInput = record(input.conclusion);
  const conclusionText = typeof conclusionInput?.text === "string" ? conclusionInput.text.trim() : "";
  const sentences = conclusionText.match(/[^.!?]+(?:[.!?]+|$)/g)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
  const conclusion = {
    text: sentences.slice(0, 2).join(" "),
    evidence: normalizeEvidenceReferences(conclusionInput?.evidence, validEvidenceIds, 8, "conclusion.evidence", log),
  };
  if (sentences.length > 2) log?.(`[AI] conclusion shortened from ${sentences.length} to 2 sentences`);
  return {
    keyThemes: normalizeFindingArray(input.keyThemes, validEvidenceIds, "keyThemes", log),
    modelsPromoted: normalizeFindingArray(input.modelsPromoted, validEvidenceIds, "modelsPromoted", log),
    offers: normalizeFindingArray(input.offers, validEvidenceIds, "offers", log),
    googleFindings: normalizeFindingArray(input.googleFindings, validEvidenceIds, "googleFindings", log),
    socialFindings: normalizeFindingArray(input.socialFindings, validEvidenceIds, "socialFindings", log),
    changesVsPreviousMonth: normalizeFindingArray(input.changesVsPreviousMonth, validEvidenceIds, "changesVsPreviousMonth", log),
    conclusion,
  };
}
