import assert from "node:assert/strict";
import { mock } from "node:test";
import sharp from "sharp";
import { eligibleAnalysisEvidence } from "../lib/brand-ad-filter";
import { readableEvidence } from "../lib/analysis-evidence";

async function main() {
  const good = { id: "good", source: "GOOGLE" as const, headline: "Peugeot 3008", selectedForSlide: true, localImagePath: "good.png", captureStatus: "READY" };
  const records = [good, { ...good, id: "foreign", headline: "Fiat" }, { ...good, id: "missing", localImagePath: null }, { ...good, id: "unselected", selectedForSlide: false }, { ...good, id: "corrupt", localImagePath: "corrupt.png" }];
  const eligible = eligibleAnalysisEvidence(records, { adIncludeKeywords: ["Peugeot"], adExcludeKeywords: ["Fiat"] });
  const reads: string[] = [];
  const result = await readableEvidence(eligible, async item => {
    reads.push(item.id);
    if (item.id === "corrupt") throw new Error("Unreadable screenshot");
    return Buffer.from("decoded-image");
  });
  assert.deepEqual(reads, ["good", "corrupt"], "Excluded, unselected and missing-image ads aren't even read");
  assert.deepEqual(result.map(entry => entry.item.id), ["good"], "Only usable image-backed metadata reaches the analysis payload");
  assert.deepEqual(await readableEvidence(eligible, async () => { throw new Error("Storage unavailable"); }), []);
  // Exercise the route as well: all unreadable images have a machine-readable
  // skip result, and a partial set cannot leave stale citations exportable.
  process.env.SUPABASE_URL = "https://storage.example.test";
  process.env.SUPABASE_SECRET_KEY = "test-key";
  delete process.env.OPENAI_API_KEY;
  const ad = (id: string) => ({ ...good, id, localImagePath: `reports/${id}.png`, selectedForAnalysisEvidence: true, cropX: null, cropY: null, cropWidth: null, cropHeight: null });
  const current = { id: "br", brand: {}, report: {}, analysisNeedsRegeneration: false, adEvidence: [ad("corrupt")] };
  Object.assign(globalThis, { prisma: {
    brandReport: {
      findUnique: async () => structuredClone(current),
      update: async ({ data }: { data: object }) => Object.assign(current, data),
    },
    adMedia: { count: async () => 0 },
    adEvidence: {
      count: async () => 0,
      updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: object }) => {
        current.adEvidence.filter(item => where.id.in.includes(item.id)).forEach(item => Object.assign(item, data));
        return { count: where.id.in.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } });
  const fixture = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } }).png().toBuffer();
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.hostname, "storage.example.test", "No real network or OpenAI calls");
    return new Response(url.pathname.includes("corrupt") ? "invalid image bytes" : new Uint8Array(fixture));
  });
  const { POST } = await import("../app/api/brand-reports/[brandReportId]/generate-analysis/route");
  const { NextRequest } = await import("next/server");
  process.env.OPENAI_API_KEY = "";
  const generate = () => POST(new NextRequest("https://example.test/analysis", { method: "POST" }), { params: Promise.resolve({ brandReportId: "br" }) });
  const empty = await generate();
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, "NO_USABLE_EVIDENCE", "Unreadable images are skippable even without AI credentials");
  current.adEvidence = [ad("good"), ad("corrupt")];
  const partial = await generate();
  assert.equal(partial.status, 503, "Valid remaining media reaches the AI configuration check");
  assert.equal(current.adEvidence[0].selectedForSlide, true);
  assert.equal(current.adEvidence[1].selectedForSlide, false);
  assert.equal(current.adEvidence[1].localImagePath, "reports/corrupt.png", "Keep stored records for review/retry");
  assert.equal(current.analysisNeedsRegeneration, true, "Stale citations are blocked if subsequent generation fails");
  console.log("Analysis storage eligibility and partial-evidence tests passed.");
}
main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
