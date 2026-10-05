import type { ActorRunPricingInfo, ActorStartOptions } from "apify-client";
import { MAX_APIFY_CANDIDATES_PER_SOURCE } from "@/lib/ad-evidence-limits";

export const DEFAULT_APIFY_MAX_CHARGE_USD_PER_RUN = 0.10;

export function apifyCostLimits(config: { APIFY_MAX_ITEMS_PER_RUN?: string; APIFY_MAX_CHARGE_USD_PER_RUN?: string } = {
  APIFY_MAX_ITEMS_PER_RUN: process.env.APIFY_MAX_ITEMS_PER_RUN,
  APIFY_MAX_CHARGE_USD_PER_RUN: process.env.APIFY_MAX_CHARGE_USD_PER_RUN,
}) {
  const items = Number(config.APIFY_MAX_ITEMS_PER_RUN);
  const charge = Number(config.APIFY_MAX_CHARGE_USD_PER_RUN);
  return {
    maxItems: Number.isSafeInteger(items) && items > 0 ? Math.min(items, MAX_APIFY_CANDIDATES_PER_SOURCE) : MAX_APIFY_CANDIDATES_PER_SOURCE,
    maxTotalChargeUsd: Number.isFinite(charge) && charge > 0 ? charge : DEFAULT_APIFY_MAX_CHARGE_USD_PER_RUN,
  };
}

export function apifyInputLimit(requested?: number) {
  const { maxItems } = apifyCostLimits();
  return Number.isSafeInteger(requested) && requested! > 0 ? Math.min(requested!, maxItems) : maxItems;
}

export function activeApifyPricing(prices: ActorRunPricingInfo[] = [], now = Date.now()) {
  return prices.filter(price => new Date(price.startedAt).getTime() <= now)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
}

export function apifyRunOptions(pricing: ActorRunPricingInfo | undefined, maxItems: number): ActorStartOptions {
  const { maxTotalChargeUsd } = apifyCostLimits();
  // The current API supports maxTotalChargeUsd for all pricing models. maxItems
  // is specifically a paid-dataset-item cap, not a pay-per-event result limit.
  return { maxTotalChargeUsd, ...(pricing?.pricingModel === "PRICE_PER_DATASET_ITEM" ? { maxItems } : {}) };
}

export function unsupportedChargeCap(error: unknown) {
  if (!(error instanceof Error)) return false;
  const status = (error as Error & { statusCode?: number }).statusCode;
  return (status === 400 || status === 422)
    && /maxTotalChargeUsd/i.test(error.message)
    && /(?:not (?:supported|allowed|available|applicable)|unsupported|only (?:works|supported|allowed|available|applicable)|(?:can|may) (?:only be|be only) (?:used|set)|used only)/i.test(error.message);
}
