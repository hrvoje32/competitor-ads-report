import assert from "node:assert/strict";
import { mock } from "node:test";
import type { AdEvidence, OfficialCaptureState } from "@prisma/client";

type Row = Record<string, unknown>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Row[]).some(filter => matches(row, filter));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as Row;
      if ("not" in filter) return row[key] !== filter.not;
      if ("lt" in filter) return (row[key] as number) < (filter.lt as number);
      return matches((row[key] as Row) ?? {}, filter);
    }
    return row[key] === value;
  });
}
function assign(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) row[key] = Number(row[key] || 0) + Number(value.increment);
    else if (value !== undefined) row[key] = value;
  }
  return row;
}

async function main() {
  delete process.env.VERCEL;
  const rows: AdEvidence[] = [], budgets: OfficialCaptureState[] = [];
  const brand = { name: "Peugeot", adIncludeKeywords: ["Peugeot"], adExcludeKeywords: ["Fiat"], metaPages: [] };
  const delegate = <T extends object>(items: T[]) => ({
    findMany: async ({ where = {} }: { where?: Row } = {}) => items.filter(item => matches(item as Row, where)),
    findUnique: async ({ where }: { where: Row }) => items.find(item => matches(item as Row, (where.brandReportId_source as Row) ?? where)) ?? null,
    findUniqueOrThrow: async ({ where }: { where: Row }) => {
      const row = items.find(item => matches(item as Row, (where.brandReportId_source as Row) ?? where)); assert.ok(row); return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = items.find(item => matches(item as Row, where)); assert.ok(row); return assign(row as Row, data);
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const found = items.filter(item => matches(item as Row, where)); found.forEach(item => assign(item as Row, data)); return { count: found.length };
    },
    count: async ({ where }: { where: Row }) => items.filter(item => matches(item as Row, where)).length,
    upsert: async ({ where, create }: { where: Row; create: Row }) => {
      let row = items.find(item => matches(item as Row, (where.brandReportId_source as Row) ?? where));
      if (!row) { row = { id: `budget-${items.length}`, attempts: 0, leaseToken: null, leaseStartedAt: null, ...create } as T; items.push(row); }
      return row;
    },
  });
  const report = () => ({ id: "report-brand", brandId: "brand", reportId: "report", brand, report: { id: "report" }, adEvidence: rows });
  const db = {
    adEvidence: delegate(rows), officialCaptureState: delegate(budgets),
    brandReport: { findUnique: async () => report(), findUniqueOrThrow: async () => report() },
    $transaction: async (operation: unknown): Promise<unknown> => typeof operation === "function" ? operation(db) : Promise.all(operation as Promise<unknown>[]),
  };
  Object.assign(globalThis, { prisma: db });
  // No live browser, storage, API, or database calls are made.
  const { captureOfficialCandidate, officialCaptureServices } = await import("../lib/official-capture");
  let opens = 0, uploads = 0;
  let outcomes: boolean[] = [];
  let failUpload = false;
  let hold: Promise<void> | undefined;
  const openedIds: string[] = [];
  mock.method(officialCaptureServices, "capture", async (url: string) => {
    opens++;
    if (hold) await hold;
    if (outcomes.shift() === false) throw new Error("Mock Browserless connection failure");
    openedIds.push(url);
    return { image: Buffer.from("test-image"), contentType: "image/png", method: "PAGE_FALLBACK", diagnostics: {} };
  });
  mock.method(officialCaptureServices, "store", async () => {
    uploads++;
    if (failUpload) throw new Error("Mock storage failure");
    return { path: `image-${uploads}.png`, byteSize: 10 };
  });
  const seed = (source: "GOOGLE" | "META", count: number) => {
    for (let index = 0; index < count; index++) rows.push({
      id: `${source}-${index}`, brandReportId: "report-brand", source, externalId: `${source}-${index}`,
      sourceUrl: `https://example.com/${source}/${index}`, snapshotUrl: null, headline: `Peugeot model ${index} offer`,
      body: null, description: null, rawData: {}, notes: null, landingPageUrl: null, format: index % 2 ? "video" : "image",
      lastShown: new Date(2026, 8, 30 - index), localImagePath: null, captureStatus: "PENDING", captureMethod: null,
      officialCaptureAttemptedAt: null, brandFilterStatus: "INCLUDED", brandFilterReason: "", captureCandidateRank: null,
      selectedForSlide: false, selectedForAnalysisEvidence: false, updatedAt: new Date(),
    } as AdEvidence);
  };
  const reset = () => { rows.length = budgets.length = openedIds.length = 0; opens = uploads = 0; outcomes = []; failUpload = false; };
  const advance = async (source: "GOOGLE" | "META", polls = 20) => {
    for (let index = 0; index < polls; index++) await captureOfficialCandidate("report-brand", source);
  };
  const state = (source: string) => budgets.find(item => item.source === source)!;

  seed("GOOGLE", 40);
  outcomes = [true, true, false, true, false, true, true];
  await advance("GOOGLE");
  assert.equal(opens, 7, "Stop opening ads immediately after five stored screenshots");
  assert.equal(rows.filter(row => row.localImagePath).length, 5);
  assert.equal(state("GOOGLE").attempts, 7, "Failures count toward attempts, not successes");
  await advance("GOOGLE");
  assert.equal(opens, 7, "Regeneration/polling must not reset the budget or reopen saved ads");

  reset(); seed("GOOGLE", 40); seed("META", 40); outcomes = Array(16).fill(false);
  await Promise.all([advance("GOOGLE"), advance("META")]);
  assert.equal(opens, 16, "Each source gets at most eight attempts");
  assert.equal(state("GOOGLE").attempts, 8); assert.equal(state("META").attempts, 8);
  assert.equal(uploads, 0);

  reset(); seed("META", 3); await advance("META");
  assert.equal(opens, 3, "Use fewer than five when only three unique creatives exist");

  reset(); seed("GOOGLE", 10);
  for (const row of rows.slice(0, 4)) { row.localImagePath = `${row.id}.png`; row.captureStatus = "READY"; }
  await advance("GOOGLE");
  assert.equal(opens, 1, "Existing valid screenshots count toward the five slots");
  assert.ok(openedIds.every(url => !rows.slice(0, 4).some(row => row.sourceUrl === url)));

  reset(); seed("META", 40); failUpload = true; await advance("META");
  assert.equal(opens, 8); assert.equal(state("META").attempts, 8);
  assert.equal(rows.filter(row => row.localImagePath).length, 0, "Upload failure is not a success");

  reset(); seed("GOOGLE", 10);
  rows[0].headline = "Fiat new offer";
  rows[1].sourceUrl = rows[2].sourceUrl;
  await advance("GOOGLE");
  assert.ok(!openedIds.includes(rows[0].sourceUrl!));
  assert.equal(openedIds.filter(url => url === rows[1].sourceUrl).length, 1);
  assert.equal(rows.length, 10, "Excluded and duplicate records are retained for inspection");
  assert.equal(rows[0].brandFilterStatus, "EXCLUDED");

  reset(); seed("GOOGLE", 10);
  let release!: () => void;
  hold = new Promise<void>(resolve => { release = resolve; });
  const pending = captureOfficialCandidate("report-brand", "GOOGLE");
  // Let the first caller reserve its attempt and enter the mocked browser.
  while (!opens) await new Promise(resolve => setTimeout(resolve, 0));
  const overlap = await captureOfficialCandidate("report-brand", "GOOGLE");
  assert.equal(overlap.busy, true);
  assert.equal(opens, 1);
  release(); await pending; hold = undefined;
  assert.equal(state("GOOGLE").leaseToken, null);
  assert.equal(state("GOOGLE").attempts, 1);
  console.log("Official capture integration tests passed: 5 successes, 8 attempts, source isolation, reuse, storage failures, exclusions, deduplication, and concurrent polls.");
}

main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
