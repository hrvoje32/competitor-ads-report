import { ApifyClient } from "apify-client";
import { env } from "@/lib/env";
import { MAX_APIFY_CANDIDATES_PER_SOURCE } from "@/lib/ad-evidence-limits";
import { activeApifyPricing, apifyInputLimit, apifyRunOptions, unsupportedChargeCap } from "@/lib/ad-providers/apify-cost-policy";
import type { AdProviderSource } from "@/lib/ad-providers/types";

export const DEFAULT_META_ACTOR_ID = "webdata_labs/meta-ads-library-scraper";
export const DEFAULT_GOOGLE_ACTOR_ID = "hyperbach/google-ads-transparency-scraper";

export function apifyClient(maxRetries?: number) {
  if (!env.APIFY_TOKEN) throw new Error("Apify is not configured. Set APIFY_TOKEN.");
  return new ApifyClient({ token: env.APIFY_TOKEN, ...(maxRetries !== undefined ? { maxRetries } : {}) });
}

export function apifyError(error: unknown) {
  const fallback = "Apify request failed.";
  if (!(error instanceof Error)) return fallback;
  const token = env.APIFY_TOKEN;
  return token ? error.message.split(token).join("[redacted]").split(encodeURIComponent(token)).join("[redacted]") : error.message;
}

export async function startApifyActor(actorId: string, input: Record<string, unknown>, context: { source: AdProviderSource; brandName: string }) {
  const definition = await apifyClient().actor(actorId).get();
  if (!definition) throw new Error("Apify actor was not found; no run was started.");
  const pricing = activeApifyPricing(definition.pricingInfos);
  const limitKey = context.source === "GOOGLE" ? "maxAds" : "maxResults";
  const requested = input[limitKey];
  const maxItems = apifyInputLimit(typeof requested === "number" ? requested : undefined);
  const boundedInput = { ...input, [limitKey]: maxItems };
  const options = apifyRunOptions(pricing, maxItems);
  // Do not automatically repeat a potentially accepted paid POST after a timeout
  // or 5xx. Only a definitive unsupported-option rejection permits one retry.
  const actor = apifyClient(0).actor(actorId);
  const log = (fallback: boolean) => console.info("Apify run cost limits", {
    source: context.source, brand: apifyError(new Error(context.brandName)).replace(/[\r\n\t]/g, " ").slice(0, 120),
    pricingModel: pricing?.pricingModel ?? "UNKNOWN",
    requestedMaxResults: maxItems,
    maxPaidItems: options.maxItems ?? null,
    maxRunChargeUsd: options.maxTotalChargeUsd ?? null,
    protection: fallback ? "actor input limit; paid-item cap where supported (charge cap unsupported)" : "actor input limit and run charge cap",
  });
  log(false);
  let run;
  try { run = await actor.start(boundedInput, options); }
  catch (error) {
    if (!unsupportedChargeCap(error)) throw error;
    delete options.maxTotalChargeUsd;
    log(true);
    run = await actor.start(boundedInput, options);
  }
  return { runId: run.id, datasetId: run.defaultDatasetId, status: run.status };
}

export async function getApifyRun(runId: string) {
  const run = await apifyClient().run(runId).get();
  if (!run) throw new Error("Apify run was not found.");
  return { runId: run.id, datasetId: run.defaultDatasetId, status: run.status };
}

export async function getApifyDatasetItems(datasetId: string) {
  const { items } = await apifyClient().dataset(datasetId).listItems({ clean: true, limit: MAX_APIFY_CANDIDATES_PER_SOURCE });
  return items.slice(0, MAX_APIFY_CANDIDATES_PER_SOURCE) as Record<string, unknown>[];
}
