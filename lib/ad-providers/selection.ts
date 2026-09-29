import { z } from "zod";

export const providerSelectionSchema = z.object({
  GOOGLE: z.enum(["APIFY", "OFFICIAL"]),
  META: z.enum(["APIFY", "OFFICIAL"]),
}).strict();
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;

export const automationRequestSchema = z.object({
  brandReportId: z.string().min(1).optional(),
  retryFailed: z.boolean().optional(),
  providers: providerSelectionSchema.optional(),
}).strict();

// Retain the provider used for each source. Older reports keep Apify as their default.
export function previousProviders(runs: Array<{ source: string; provider: string }>): ProviderSelection {
  return {
    GOOGLE: runs.find(run => run.source === "GOOGLE")?.provider === "OFFICIAL" ? "OFFICIAL" : "APIFY",
    META: runs.find(run => run.source === "META")?.provider === "OFFICIAL" ? "OFFICIAL" : "APIFY",
  };
}

export function providerLabel(source: string, provider: string) {
  return provider === "OFFICIAL" ? source === "GOOGLE" ? "Google BigQuery" : "Meta Ad Library API" : "Apify";
}
