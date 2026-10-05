import assert from "node:assert/strict";
import { mock } from "node:test";
import { automationRequestSchema, previousProviders } from "../lib/ad-providers/selection";

// In-memory database and mocked upstream clients: no account, paid run, or storage writes.
type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some(item => matches(row, item));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as Row;
      if ("in" in filter) return (filter.in as unknown[]).includes(row[key]);
      if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(row[key]);
      if ("not" in filter) return row[key] !== filter.not;
      if ("lt" in filter) return row[key] instanceof Date && (row[key] as Date) < (filter.lt as Date);
      return matches(row[key] as Row ?? {}, filter);
    }
    return row[key] === value;
  });
}
function assign(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = value;
  return row;
}

async function main() {
  process.env.GCP_PROJECT_ID = "test-project";
  process.env.GCP_PROJECT_NUMBER = "123";
  process.env.GCP_SERVICE_ACCOUNT_EMAIL = "test@example.com";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_ID = "test";
  process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID = "test";
  process.env.META_ACCESS_TOKEN = "test-meta-token";
  process.env.META_GRAPH_API_VERSION = "v23.0";
  process.env.APIFY_TOKEN = "test-apify-token";
  process.env.VERCEL = "1";
  delete process.env.BROWSER_WS_ENDPOINT;

  const unexpected = () => { throw new Error("Unexpected database call"); };
  const delegate = () => Object.fromEntries(["findUnique", "findUniqueOrThrow", "findFirst", "findMany", "update", "updateMany", "upsert", "count", "deleteMany"].map(name => [name, unexpected]));
  // Prisma's delegates are proxies; install plain delegates before the app imports its singleton.
  Object.assign(globalThis, { prisma: { brandReport: delegate(), report: delegate(), adProviderRun: delegate(), officialCaptureState: delegate(), adEvidence: delegate(), adMedia: delegate(), $transaction: unexpected } });
  const { prisma } = await import("../lib/prisma");
  const { BigQuery } = await import("@google-cloud/bigquery");
  const { ApifyClient } = await import("apify-client");
  const { startBrandAutomation, advanceBrandCollection } = await import("../lib/report-automation");
  const { bigQueryOptions, googleDate } = await import("../lib/google-ads-transparency");
  const { testMetaConnection } = await import("../lib/meta-ad-library");

  assert.deepEqual(previousProviders([]), { GOOGLE: "APIFY", META: "APIFY" });
  for (const GOOGLE of ["APIFY", "OFFICIAL"] as const) for (const META of ["APIFY", "OFFICIAL"] as const) {
    assert.deepEqual(previousProviders([{ source: "GOOGLE", provider: GOOGLE }, { source: "META", provider: META }]), { GOOGLE, META });
    assert.equal(automationRequestSchema.safeParse({ providers: { GOOGLE, META } }).success, true);
  }
  assert.equal(automationRequestSchema.safeParse({ providers: { GOOGLE: "invalid", META: "OFFICIAL" } }).success, false);
  assert.equal(bigQueryOptions({ query: "SELECT 1", maximumBytesBilled: "999999999999" }).maximumBytesBilled, "10737418240");
  assert.equal(googleDate({ value: "2026-09-03" })?.toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(googleDate("bad date"), null);

  const runs: Row[] = [];
  const budgets: Row[] = [];
  const evidence: Row[] = [{
    id: "saved", brandReportId: "brand-report", source: "GOOGLE", externalId: "creative-1",
    headline: "Existing ad copy", body: null, description: null, cta: null, landingPageUrl: null,
    localImagePath: "preserved.webp", cropX: 10, notes: "User notes", rawData: { original: true },
    captureStatus: "READY", sortOrder: 0, createdAt: new Date(),
  }];
  const brand: Row = {
    id: "brand-report", brandId: "brand", reportId: "report", automationStatus: "PENDING",
    googleStatus: "PENDING", metaStatus: "PENDING", providerRuns: runs,
    brand: { name: "Example", googleDomain: "example.com", googleAdvertisers: [{ advertiserId: "advertiser-1" }], metaPages: [{ pageId: "123" }] },
    report: { countryCode: "HR", startDate: new Date("2026-09-02"), endDate: new Date("2026-09-29") },
  };
  mock.method(prisma.brandReport, "findUnique", async () => structuredClone({ ...brand, adEvidence: evidence }));
  mock.method(prisma.brandReport, "update", async ({ data }: { data: Row }) => assign(brand, data));
  mock.method(prisma.brandReport, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    if (!matches(brand, where)) return { count: 0 };
    assign(brand, data); return { count: 1 };
  });
  mock.method(prisma.report, "update", async () => ({}));
  mock.method(prisma, "$transaction", async (operation: Promise<unknown>[] | ((tx: typeof prisma) => Promise<unknown>)) => typeof operation === "function" ? operation(prisma) : Promise.all(operation));
  mock.method(prisma.officialCaptureState, "upsert", async ({ where, create }: { where: { brandReportId_source: Row }; create: Row }) => {
    let state = budgets.find(row => matches(row, where.brandReportId_source));
    if (!state) { state = { id: `budget-${budgets.length}`, attempts: 0, leaseToken: null, leaseStartedAt: null, ...create }; budgets.push(state); }
    return state;
  });
  for (const method of ["findUnique", "findUniqueOrThrow"] as const) mock.method(prisma.officialCaptureState, method, async ({ where }: { where: { brandReportId_source: Row } }) => budgets.find(row => matches(row, where.brandReportId_source)) ?? null);
  mock.method(prisma.officialCaptureState, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    const found = budgets.filter(row => matches(row, where)); found.forEach(row => assign(row, data)); return { count: found.length };
  });
  mock.method(prisma.adProviderRun, "upsert", async ({ where, create, update }: { where: { brandReportId_source: Row }; create: Row; update: Row }) => {
    const found = runs.find(run => matches(run, where.brandReportId_source));
    if (found) return assign(found, update);
    const run = { id: `run-${runs.length}`, provider: "APIFY", status: "PENDING", itemsPersistedAt: null, ...create };
    runs.push(run); return run;
  });
  mock.method(prisma.adProviderRun, "update", async ({ where, data }: { where: Row; data: Row }) => {
    const run = runs.find(run => matches(run, (where.brandReportId_source as Row) ?? where));
    assert.ok(run); return assign(run, data);
  });
  mock.method(prisma.adProviderRun, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    const found = runs.filter(run => matches(run, where)); found.forEach(run => assign(run, data)); return { count: found.length };
  });
  mock.method(prisma.adProviderRun, "findUniqueOrThrow", async ({ where }: { where: Row }) => structuredClone(runs.find(run => matches(run, where))));
  mock.method(prisma.adEvidence, "upsert", async ({ where, create, update }: { where: { brandReportId_source_externalId: Row }; create: Row; update: Row }) => {
    const found = evidence.find(item => matches(item, where.brandReportId_source_externalId));
    if (found) return assign(found, update);
    const item = { id: `evidence-${evidence.length}`, localImagePath: null, captureCandidateRank: null, officialCaptureAttemptedAt: null, ...create }; evidence.push(item); return item;
  });
  mock.method(prisma.adEvidence, "findMany", async ({ where }: { where: Row }) => evidence.filter(item => matches(item, where)));
  mock.method(prisma.adEvidence, "findFirst", async ({ where }: { where: Row }) => evidence.find(item => matches(item, where)) ?? null);
  mock.method(prisma.adEvidence, "count", async ({ where }: { where: Row }) => evidence.filter(item => matches(item, where)).length);
  mock.method(prisma.adEvidence, "update", async ({ where, data }: { where: Row; data: Row }) => {
    const item = evidence.find(item => matches(item, where)); assert.ok(item); return assign(item, data);
  });
  mock.method(prisma.adEvidence, "updateMany", async ({ where, data }: { where: Row; data: Row }) => {
    const found = evidence.filter(item => matches(item, where)); found.forEach(item => assign(item, data)); return { count: found.length };
  });
  mock.method(prisma.adEvidence, "deleteMany", async () => { throw new Error("Evidence must not be deleted when switching providers."); });
  mock.method(prisma.adMedia, "count", async () => 0);
  mock.method(prisma.adMedia, "updateMany", async () => ({ count: 0 }));
  mock.method(prisma.adMedia, "findMany", async () => []);

  let queryCount = 0;
  let failGoogle = false;
  mock.method(BigQuery.prototype, "query", async (options: Row) => {
    queryCount++;
    assert.equal(options.maximumBytesBilled, "10737418240");
    if (failGoogle) throw new Error("Google authorization failed");
    return [[{ advertiser_id: "advertiser-1", creative_id: "creative-1", topic: "Vehicles", first_shown: { value: "2026-09-03" }, last_shown: { value: "2026-09-20" } }]];
  });
  let failMeta = false;
  let metaCalls = 0;
  mock.method(globalThis, "fetch", async (input: URL, options: RequestInit) => {
    metaCalls++;
    assert.equal(input.hostname, "graph.facebook.com");
    assert.equal(input.searchParams.has("access_token"), false);
    assert.equal((options.headers as Record<string, string>).Authorization, "Bearer test-meta-token");
    if (failMeta) return Response.json({ error: { message: "Bad token test-meta-token" } }, { status: 401 });
    const ad = { id: "meta-1", page_id: "123", ad_creative_link_titles: ["Offer"], ad_delivery_start_time: "2026-09-03", eu_total_reach: 42, ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=meta-1&access_token=test-meta-token" };
    return Response.json({ data: [ad, ad, { ...ad, id: "wrong-brand", page_id: "999" }, { ...ad, id: "old-ad", ad_delivery_start_time: "2025-01-01", ad_delivery_stop_time: "2025-01-20" }] });
  });
  let apifyCalls = 0;
  mock.method(ApifyClient.prototype, "actor", () => ({ start: async () => { apifyCalls++; return { id: "apify-run", defaultDatasetId: "dataset", status: "RUNNING" }; } }));
  mock.method(ApifyClient.prototype, "run", () => ({ get: async () => ({ id: "apify-run", defaultDatasetId: "dataset", status: "SUCCEEDED" }) }));
  mock.method(ApifyClient.prototype, "dataset", () => ({ listItems: async () => ({ items: [{ creative_id: "creative-1", headline: "Updated ad copy", first_shown: "2026-09-03", last_shown: "2026-09-20" }] }) }));

  await testMetaConnection();
  await startBrandAutomation("brand-report", { providers: { GOOGLE: "OFFICIAL", META: "OFFICIAL" } });
  await assert.rejects(startBrandAutomation("brand-report"), /already running/);
  await Promise.all([advanceBrandCollection("brand-report"), advanceBrandCollection("brand-report")]);
  assert.equal(queryCount, 1, "Concurrent polls must not duplicate the BigQuery query");
  assert.equal(metaCalls, 2, "Connection check plus one collection request");
  assert.equal(apifyCalls, 0);
  assert.equal(runs.every(run => run.status === "SUCCEEDED"), true);
  assert.equal(evidence.length, 3, "Deduplicate, retain excluded Page records, and reject out-of-period ads");
  assert.equal(evidence.find(item => item.externalId === "wrong-brand")?.brandFilterStatus, "EXCLUDED");
  assert.equal(evidence[0].headline, "Existing ad copy", "Topic must not replace ad copy");
  assert.equal(evidence[0].localImagePath, "preserved.webp");
  assert.equal(evidence[0].cropX, 10);
  assert.equal(evidence[0].notes, "User notes");
  assert.equal(evidence[1].reachLower, 42);
  assert.equal(String(evidence[1].sourceUrl).includes("access_token"), false);
  assert.equal(evidence[1].captureStatus, "CAPTURE_FAILED", "Missing browser setup must finish with an actionable warning");

  brand.automationStatus = "READY";
  failGoogle = failMeta = true;
  await startBrandAutomation("brand-report"); // Remembers official providers.
  await advanceBrandCollection("brand-report");
  assert.equal(runs.every(run => run.status === "FAILED"), true);
  assert.equal(evidence.length, 3);
  assert.equal(apifyCalls, 0, "Official failures must never trigger paid fallback");
  assert.equal(String(runs[1].error).includes("test-meta-token"), false);

  brand.automationStatus = "FAILED";
  await startBrandAutomation("brand-report", { failedOnly: true, providers: { GOOGLE: "APIFY", META: "OFFICIAL" } });
  assert.equal(apifyCalls, 1, "Only the explicitly selected source may use Apify");
  assert.equal(runs[0].provider, "APIFY");
  assert.equal(runs[0].runId, "apify-run");
  assert.equal(runs[1].provider, "OFFICIAL");
  await advanceBrandCollection("brand-report");
  assert.equal(runs[0].status, "SUCCEEDED", "Switching back must poll and import the Apify dataset");
  assert.equal(evidence[0].headline, "Updated ad copy");
  assert.equal(evidence[0].localImagePath, "preserved.webp");
  // An exhausted official budget must not disable Apify media processing.
  brand.automationStatus = "READY";
  evidence[0].localImagePath = null;
  evidence[0].captureStatus = "CAPTURE_FAILED";
  evidence[0].officialCaptureAttemptedAt = new Date();
  const googleBudget = budgets.find(row => row.source === "GOOGLE")!;
  googleBudget.attempts = 8;
  const priorApifyCalls = apifyCalls;
  await startBrandAutomation("brand-report", { providers: { GOOGLE: "APIFY", META: "OFFICIAL" } });
  await advanceBrandCollection("brand-report");
  assert.equal(apifyCalls, priorApifyCalls, "Regeneration reuses a completed dataset instead of starting another paid run");
  assert.equal(evidence[0].captureStatus, "CAPTURE_FAILED");
  assert.equal(runs[0].status, "SUCCEEDED", "Exhausted media does not prevent partial report analysis");
  assert.equal(googleBudget.attempts, 8, "Provider switching must not restore the official budget");
  console.log("Provider switching, official collection, cost guard, concurrency, and evidence preservation tests passed.");
}

main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
