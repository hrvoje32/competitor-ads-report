import assert from "node:assert/strict";
import { analysisSchema, normalizeAnalysisResponse, normalizeEvidenceReferences } from "../lib/analysis";

const valid = new Set(["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "M1", "M2"]);
const oversized = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "M1", "M2"];
assert.deepEqual(normalizeEvidenceReferences(oversized, valid), ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"]);
assert.deepEqual(normalizeEvidenceReferences(["G1", "G1", "G99", "[m1]", 42], valid), ["G1", "M1"]);

const rawFinding = { text: "Supported finding", evidence: oversized };
const normalized = normalizeAnalysisResponse({
  keyThemes: [rawFinding],
  modelsPromoted: [{ ...rawFinding, evidence: [...oversized, "G99"] }],
  offers: [{ text: "", evidence: ["G1"] }],
  googleFindings: [rawFinding],
  socialFindings: [{ text: "Social finding", evidence: "M1" }],
  changesVsPreviousMonth: [],
  conclusion: { text: "Supported conclusion", evidence: [...oversized, "G1", "G99"] },
}, valid);

const parsed = analysisSchema.parse(normalized);
assert.equal(parsed.modelsPromoted[0].evidence.length, 8);
assert.equal(parsed.conclusion.evidence.length, 8);
assert.equal(parsed.offers.length, 0);
assert.deepEqual(parsed.socialFindings[0].evidence, ["M1"]);

const repeated = Array.from({ length: 6 }, (_, index) => ({ text: `Finding ${index + 1}`, evidence: ["G1"], classification: "CONTINUING" }));
const capped = analysisSchema.parse(normalizeAnalysisResponse({
  keyThemes: repeated,
  modelsPromoted: repeated,
  offers: repeated,
  googleFindings: repeated,
  socialFindings: repeated,
  changesVsPreviousMonth: repeated,
  conclusion: { text: "First sentence. Second sentence! Third sentence?", evidence: ["G1"] },
}, valid));
assert.equal(capped.keyThemes.length, 3);
assert.equal(capped.modelsPromoted.length, 4);
assert.equal(capped.offers.length, 3);
assert.equal(capped.googleFindings.length, 3);
assert.equal(capped.socialFindings.length, 3);
assert.equal(capped.changesVsPreviousMonth.length, 3);
assert.equal(capped.changesVsPreviousMonth[0].classification, "CONTINUING");
assert.equal(capped.conclusion.text, "First sentence. Second sentence!");
console.log("Analysis evidence normalization passed.");
