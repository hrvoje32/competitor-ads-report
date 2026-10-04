import assert from "node:assert/strict";
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
  console.log("Analysis storage eligibility and partial-evidence tests passed.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
