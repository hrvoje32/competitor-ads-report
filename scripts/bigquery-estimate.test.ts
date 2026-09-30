import assert from "node:assert/strict";
import { mock } from "node:test";
import type { Query } from "@google-cloud/bigquery";

async function main() {
  // Synthetic configuration only; no dotenv loader, credentials, or live services.
  Object.assign(process.env, {
    GCP_PROJECT_ID: "test-project",
    GCP_PROJECT_NUMBER: "123",
    GCP_SERVICE_ACCOUNT_EMAIL: "test@example.com",
    GCP_WORKLOAD_IDENTITY_POOL_ID: "test",
    GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: "test",
    BIGQUERY_MAX_BYTES_BILLED: "10737418240",
  });
  const inputs = {
    advertiserIds: ["AR123", "AR456"], countryCode: "HR",
    startDate: "2026-09-02", endDate: "2026-09-29",
  };
  let missingReport = false;
  let missingAdvertisers = false;
  const database = {
    brandReport: {
      async findFirst(options: unknown) {
        assert.deepEqual(options, {
          where: { id: "brand-report", reportId: "report", brandId: "brand" },
          include: { brand: { include: { googleAdvertisers: true } }, report: true },
        });
        if (missingReport) return null;
        return {
          brand: { googleAdvertisers: missingAdvertisers ? [] : inputs.advertiserIds.map(advertiserId => ({ advertiserId })) },
          report: { countryCode: "hr", startDate: new Date(inputs.startDate), endDate: new Date(inputs.endDate) },
        };
      },
    },
  };
  // No write methods: any attempted mutation fails this test.
  Object.assign(globalThis, { prisma: database });
  mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network request"); });
  const { BigQuery } = await import("@google-cloud/bigquery");
  const { env } = await import("../lib/env");
  const { estimateCreativesQuery, fetchCreatives } = await import("../lib/google-ads-transparency");
  const { estimateGoogleAdsForReport } = await import("../app/reports/[id]/brands/[brandReportId]/bigquery-estimate-actions");

  let totalBytesProcessed: unknown = "19756849561";
  let failDryRun = false;
  let dryRunCalls = 0;
  let dryRunOptions: Query | undefined;
  const dryRun = mock.method(BigQuery.prototype, "createQueryJob", async (options: Query) => {
    dryRunCalls++;
    assert.equal(options.dryRun, true);
    assert.equal(options.useQueryCache, false);
    assert.equal(options.useLegacySql, false);
    assert.equal(options.maximumBytesBilled, undefined, "An over-limit dry run must still return its estimate");
    assert.deepEqual(options.params, inputs);
    dryRunOptions = options;
    if (failDryRun) throw new Error("Upstream credential: secret-test-value");
    return [{ metadata: { statistics: { totalBytesProcessed } } }];
  });
  const execution = mock.method(BigQuery.prototype, "query", async () => {
    throw new Error("Diagnostic must not execute a collection query");
  });

  const result = await estimateGoogleAdsForReport("report", "brand", "brand-report");
  assert.ok("estimate" in result);
  assert.deepEqual(result.estimate, {
    ...inputs,
    totalBytesProcessed: "19756849561",
    estimatedGiB: 19756849561 / 2 ** 30,
    maximumBytesBilled: "10737418240",
    limitGiB: 10,
    exceedsLimit: true,
  });
  assert.equal(execution.mock.callCount(), 0);
  assert.doesNotThrow(() => JSON.stringify(result), "Response must be serializable");

  const estimate = () => estimateCreativesQuery(inputs.advertiserIds, "hr", inputs.startDate, inputs.endDate);
  for (const [bytes, exceeds] of [["0", false], ["10737418239", false], ["10737418240", false], ["10737418241", true]] as const) {
    totalBytesProcessed = bytes;
    assert.equal((await estimate()).exceedsLimit, exceeds);
  }
  env.BIGQUERY_MAX_BYTES_BILLED = "9007199254740992";
  totalBytesProcessed = "9007199254740993";
  assert.equal((await estimate()).exceedsLimit, true, "Comparison must not round byte counts");
  assert.equal((await estimate()).totalBytesProcessed, "9007199254740993");
  env.BIGQUERY_MAX_BYTES_BILLED = "10737418240";

  for (const invalid of [undefined, null, "", "invalid", "-1", "1.5", 123]) {
    totalBytesProcessed = invalid;
    await assert.rejects(estimate(), /valid scan estimate/);
  }
  failDryRun = true;
  const failed = await estimateGoogleAdsForReport("report", "brand", "brand-report");
  assert.ok("error" in failed);
  assert.equal(JSON.stringify(failed).includes("secret-test-value"), false);
  const callsBeforeMissingInputs = dryRunCalls;
  missingAdvertisers = true;
  assert.deepEqual(await estimateGoogleAdsForReport("report", "brand", "brand-report"), {
    error: "Add Google Advertiser IDs in the brand settings before estimating.",
  });
  missingReport = true;
  assert.deepEqual(await estimateGoogleAdsForReport("report", "brand", "brand-report"), { error: "Brand report was not found." });
  await assert.rejects(() => estimateCreativesQuery([], "HR", inputs.startDate, inputs.endDate), /Advertiser IDs/);
  assert.equal(dryRunCalls, callsBeforeMissingInputs);
  assert.equal(execution.mock.callCount(), 0, "All diagnostic paths must avoid query execution");

  // Compare the actual collection request to the captured dry run using mocked SDK calls.
  execution.mock.restore();
  const collection = mock.method(BigQuery.prototype, "query", async (options: Query) => {
    assert.ok(dryRunOptions);
    assert.equal(options.query, dryRunOptions.query);
    assert.deepEqual(options.params, dryRunOptions.params);
    assert.deepEqual(options.types, dryRunOptions.types);
    assert.equal(options.maximumBytesBilled, "10737418240", "Collection must retain its configured limit");
    assert.equal(options.dryRun, undefined);
    assert.equal(options.useQueryCache, undefined, "Collection cache behavior must stay unchanged");
    return [[]];
  });
  const dryRunsBeforeCollection = dryRun.mock.callCount();
  assert.deepEqual(await fetchCreatives(inputs.advertiserIds, "hr", inputs.startDate, inputs.endDate), []);
  assert.equal(collection.mock.callCount(), 1);
  assert.equal(dryRun.mock.callCount(), dryRunsBeforeCollection, "Collection must not add a diagnostic request");
  console.log("BigQuery dry-run safety, query parity, report inputs, limits, and error handling tests passed.");
}

main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
