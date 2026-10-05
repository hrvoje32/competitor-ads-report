import assert from "node:assert/strict";
import { mock } from "node:test";
import type { ActorRunPricingInfo } from "apify-client";
import { activeApifyPricing, apifyCostLimits, apifyInputLimit } from "../lib/ad-providers/apify-cost-policy";

async function main() {
  process.env.APIFY_TOKEN = "test/token+never-log";
  delete process.env.APIFY_MAX_ITEMS_PER_RUN;
  delete process.env.APIFY_MAX_CHARGE_USD_PER_RUN;
  const { ApifyClient } = await import("apify-client");
  const { startApifyActor } = await import("../lib/ad-providers/apify");
  const { googleApifyProvider } = await import("../lib/ad-providers/google/apify");
  const { metaApifyProvider } = await import("../lib/ad-providers/meta/apify");
  const price = (pricingModel: string, date = "2026-01-01") => ({ pricingModel, startedAt: new Date(date) }) as ActorRunPricingInfo;
  let prices = [price("PAY_PER_EVENT")];
  const starts: Array<{ actorId: string; input: Record<string, unknown>; options: Record<string, unknown>; retries: number }> = [];
  let rejectStart: Error | undefined, rejectMetadata = false;
  const logs: unknown[][] = [];
  mock.method(console, "info", (...args: unknown[]) => { logs.push(args); });
  mock.method(ApifyClient.prototype, "actor", function(this: InstanceType<typeof ApifyClient>, actorId: string) {
    return {
      get: async () => { if (rejectMetadata) throw new Error("Metadata unavailable"); return { pricingInfos: prices }; },
      start: async (input: Record<string, unknown>, options: Record<string, unknown>) => {
        starts.push({ actorId, input: structuredClone(input), options: structuredClone(options), retries: this.httpClient.maxRetries });
        if (rejectStart) { const error = rejectStart; rejectStart = undefined; throw error; }
        return { id: "run", defaultDatasetId: "dataset", status: "RUNNING" };
      },
    };
  });
  assert.deepEqual(apifyCostLimits({}), { maxItems: 20, maxTotalChargeUsd: .10 });
  for (const invalid of ["", "0", "-1", "NaN", "Infinity", "unlimited"]) {
    assert.deepEqual(apifyCostLimits({ APIFY_MAX_ITEMS_PER_RUN: invalid, APIFY_MAX_CHARGE_USD_PER_RUN: invalid }), { maxItems: 20, maxTotalChargeUsd: .10 });
  }
  assert.equal(apifyCostLimits({ APIFY_MAX_ITEMS_PER_RUN: "1000" }).maxItems, 20);
  assert.equal(apifyCostLimits({ APIFY_MAX_ITEMS_PER_RUN: "1.5" }).maxItems, 20);
  assert.deepEqual(apifyCostLimits({ APIFY_MAX_ITEMS_PER_RUN: "7", APIFY_MAX_CHARGE_USD_PER_RUN: ".04" }), { maxItems: 7, maxTotalChargeUsd: .04 });
  const request = { brandName: "Peugeot", googleDomain: "peugeot.hr", metaPageIds: ["123"], countryCode: "HR", startDate: "2026-09-01", endDate: "2026-09-30", maxResults: 1000 };
  for (const provider of [googleApifyProvider(request), metaApifyProvider(request)]) {
    const result = await startApifyActor(provider.actorId, provider.input, { source: provider.source, brandName: request.brandName });
    assert.equal(result.runId, "run");
    const call = starts.at(-1)!;
    assert.equal(call.input.maxAds ?? call.input.maxResults, 20);
    assert.deepEqual(call.options, { maxTotalChargeUsd: .10 }, "PPE actors use charge cap; maxItems is not a PPE limit");
    assert.equal(call.retries, 0, "Paid starts must not be automatically retried after ambiguous network failures");
  }
  prices = [price("PRICE_PER_DATASET_ITEM")];
  await startApifyActor("custom/ppr", { maxResults: 999 }, { source: "META", brandName: "Peugeot" });
  assert.deepEqual(starts.at(-1)!.options, { maxItems: 20, maxTotalChargeUsd: .10 });
  assert.equal(starts.at(-1)!.input.maxResults, 20);
  process.env.APIFY_MAX_ITEMS_PER_RUN = "7";
  process.env.APIFY_MAX_CHARGE_USD_PER_RUN = ".04";
  assert.equal(googleApifyProvider(request).input.maxAds, 7);
  assert.equal(metaApifyProvider(request).input.maxResults, 7);
  assert.equal(apifyInputLimit(3), 3);
  await startApifyActor("custom/ppr", { maxAds: 999 }, { source: "GOOGLE", brandName: "Peugeot" });
  assert.deepEqual(starts.at(-1)!.options, { maxItems: 7, maxTotalChargeUsd: .04 });
  assert.equal(starts.at(-1)!.input.maxAds, 7);
  delete process.env.APIFY_MAX_ITEMS_PER_RUN;
  delete process.env.APIFY_MAX_CHARGE_USD_PER_RUN;
  rejectStart = Object.assign(new Error("maxTotalChargeUsd is not supported by this pricing model"), { statusCode: 400 });
  let before = starts.length;
  await startApifyActor("custom/ppr", { maxResults: 999 }, { source: "META", brandName: "Peugeot" });
  assert.equal(starts.length - before, 2);
  assert.deepEqual(starts.at(-1)!.options, { maxItems: 20 });
  assert.equal(starts.at(-1)!.input.maxResults, 20);
  assert.equal((logs.at(-1)![1] as Record<string, unknown>).maxRunChargeUsd, null, "Fallback logs must not claim the charge cap is active");
  for (const error of [
    new Error("Network timeout after POST"),
    Object.assign(new Error("maxTotalChargeUsd is not supported"), { statusCode: 500 }),
    Object.assign(new Error("maxTotalChargeUsd must be at least 1"), { statusCode: 400 }),
    Object.assign(new Error("Invalid input"), { statusCode: 400 }),
    Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
  ]) {
    rejectStart = error; before = starts.length;
    await assert.rejects(startApifyActor("custom/ppr", {}, { source: "GOOGLE", brandName: "Peugeot" }), error);
    assert.equal(starts.length - before, 1, "Never drop the cap or duplicate a run for unrelated/ambiguous failures");
  }
  assert.equal(activeApifyPricing([price("FREE", "2020-01-01"), price("PAY_PER_EVENT", "2025-01-01"), price("PRICE_PER_DATASET_ITEM", "2099-01-01")])?.pricingModel, "PAY_PER_EVENT");
  prices = [];
  await startApifyActor("custom/unknown", {}, { source: "GOOGLE", brandName: `Peugeot\n${process.env.APIFY_TOKEN} ${encodeURIComponent(process.env.APIFY_TOKEN!)}` });
  assert.equal(starts.at(-1)!.options.maxTotalChargeUsd, .10, "Unknown pricing retains the cap until the API explicitly rejects it");
  assert.equal(starts.at(-1)!.input.maxAds, 20);
  assert.ok(!JSON.stringify(logs).includes(process.env.APIFY_TOKEN!));
  assert.ok(!JSON.stringify(logs).includes(encodeURIComponent(process.env.APIFY_TOKEN!)));
  rejectMetadata = true; before = starts.length;
  await assert.rejects(startApifyActor("custom/unknown", {}, { source: "META", brandName: "Peugeot" }), /Metadata unavailable/);
  assert.equal(starts.length, before, "An unsuccessful pricing check must not start an unchecked paid run");
  console.log("Apify cost defaults/configuration, actor input limits, PPE/PPR options, safe fallback, no ambiguous retries, pricing dates and token-safe logging tests passed.");
}
main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
