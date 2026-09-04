import { z } from "zod";

const finding = z.object({ text: z.string().trim().min(1).max(1200), evidence: z.array(z.string().regex(/^[GM]\d+$/)).min(1).max(8) });
export const analysisSchema = z.object({
  keyThemes: z.array(finding),
  modelsPromoted: z.array(finding),
  offers: z.array(finding),
  googleFindings: z.array(finding),
  socialFindings: z.array(finding),
  changesVsPreviousMonth: z.array(finding),
  conclusion: finding,
});
export type Analysis = z.infer<typeof analysisSchema>;
export const emptyAnalysis: Analysis = { keyThemes: [], modelsPromoted: [], offers: [], googleFindings: [], socialFindings: [], changesVsPreviousMonth: [], conclusion: { text: "", evidence: [] } };
export const analysisJsonSchema = { type: "object", additionalProperties: false, required: ["keyThemes", "modelsPromoted", "offers", "googleFindings", "socialFindings", "changesVsPreviousMonth", "conclusion"], properties: { keyThemes: { type: "array", items: findingSchema() }, modelsPromoted: { type: "array", items: findingSchema() }, offers: { type: "array", items: findingSchema() }, googleFindings: { type: "array", items: findingSchema() }, socialFindings: { type: "array", items: findingSchema() }, changesVsPreviousMonth: { type: "array", items: findingSchema() }, conclusion: findingSchema() } };
function findingSchema() { return { type: "object", additionalProperties: false, required: ["text", "evidence"], properties: { text: { type: "string" }, evidence: { type: "array", items: { type: "string" } } } }; }
