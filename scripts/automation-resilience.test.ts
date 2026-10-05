import assert from "node:assert/strict";
import { mock } from "node:test";
import { automationRequest, AutomationRequestError, monitorAutomation, type AutomationSnapshot } from "../lib/automation-client";
import { finishBrandAutomation } from "../lib/finish-brand-automation";
import { ANALYSIS_SKIPPED_NO_MEDIA, NO_USABLE_EVIDENCE, analysisWasSkipped } from "../lib/automation-result";
import { reportExportBlocked, reportExportWarnings } from "../lib/report-readiness";

async function main() {
  const calls: string[] = [], delays: number[] = [], notices: string[] = [], snapshots: AutomationSnapshot[] = [];
  const responses = [
    () => { throw new DOMException("The string did not match the expected pattern.", "SyntaxError"); },
    () => new Response("<html>Gateway Timeout</html>", { status: 504 }),
    () => new Response('{"done":'),
    () => Response.json({ unrelated: true }),
    () => Response.json({ done: false, brands: [{ id: "good", automationStatus: "CAPTURING" }] }),
    () => Response.json({ done: true, brands: [{ id: "good", automationStatus: "READY" }] }),
  ];
  mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    calls.push(init.method ?? "GET");
    assert.ok(responses.length, "Never exceed expected polling requests");
    return responses.shift()!();
  });
  await monitorAutomation("https://example.test/automate", {
    signal: new AbortController().signal,
    onSnapshot: snapshot => snapshots.push(snapshot), onRetry: message => notices.push(message),
    delay: async ms => { delays.push(ms); },
  });
  assert.deepEqual(calls, Array(6).fill("GET"), "Recovery never starts another paid collection run");
  assert.deepEqual(delays, [6000, 12000, 24000, 30000, 3000]);
  assert.deepEqual(snapshots.map(snapshot => snapshot.done), [false, true]);
  assert.ok(!notices.join(" ").includes("expected pattern"));
  assert.equal(notices.at(-1), "", "Successful response clears the retry notice");
  mock.restoreAll();

  let attempts = 0;
  mock.method(globalThis, "fetch", async () => { attempts++; return new Response("<html>Sign in</html>", { status: 401 }); });
  await assert.rejects(monitorAutomation("https://example.test/automate", {
    signal: new AbortController().signal, onSnapshot: () => assert.fail(), onRetry: () => assert.fail(),
  }), (error: unknown) => error instanceof AutomationRequestError && !error.retryable && /Sign in/.test(error.message));
  assert.equal(attempts, 1);
  mock.restoreAll();
  attempts = 0;
  mock.method(globalThis, "fetch", async () => { attempts++; return new Response("<html>Timeout</html>", { status: 504 }); });
  await assert.rejects(automationRequest("https://example.test/automate", { method: "POST" }), AutomationRequestError);
  assert.equal(attempts, 1, "Ambiguous POST is never retried automatically");
  const controller = new AbortController();
  await monitorAutomation("https://example.test/automate", {
    signal: controller.signal, onSnapshot: () => assert.fail(), onRetry: () => controller.abort(), delay: async () => {},
  });
  assert.equal(attempts, 2, "Unmount/abort stops the polling loop");
  mock.restoreAll();

  const generated: string[] = [], finished: string[] = [], skipped: string[] = [], failed: string[] = [];
  const services = {
    advance: async (id: string) => ({ readyForAnalysis: id !== "fetching", done: id === "done" }),
    claim: async (id: string) => id !== "claimed-elsewhere",
    select: async (id: string) => ({ analysis: id === "empty" ? 0 : 1 }),
    generate: async (id: string) => {
      generated.push(id);
      if (id === "unreadable") return Response.json({ code: NO_USABLE_EVIDENCE, error: "No readable images" }, { status: 400 });
      if (id === "ai-failure") return Response.json({ error: "AI unavailable" }, { status: 502 });
      return Response.json({ success: true });
    },
    ready: async (id: string) => { finished.push(id); },
    skipped: async (id: string) => { skipped.push(id); },
    failed: async (id: string) => { failed.push(id); },
  };
  for (const id of ["empty", "meta-only", "google-only", "unreadable", "ai-failure", "fetching", "done", "claimed-elsewhere"]) await finishBrandAutomation(id, services);
  assert.deepEqual(generated, ["meta-only", "google-only", "unreadable", "ai-failure"], "No AI call without evidence; either source alone suffices");
  assert.deepEqual(finished, ["meta-only", "google-only"]);
  assert.deepEqual(skipped, ["empty", "unreadable"]);
  assert.deepEqual(failed, ["ai-failure"], "Actual AI errors remain failures, not empty-evidence success");

  const brand = { automationStatus: "READY", automationError: ANALYSIS_SKIPPED_NO_MEDIA, brand: { name: "Peugeot" }, adEvidence: [], analysisJson: "retained previous analysis", analysisEditedJson: null };
  assert.equal(analysisWasSkipped(brand), true);
  assert.equal(analysisWasSkipped({ ...brand, automationStatus: "FAILED" }), false);
  assert.equal(reportExportBlocked([brand]), false);
  assert.ok(reportExportWarnings([brand]).some(message => message.includes("Analysis skipped")));
  const retainedBrand = { ...brand, analysisEditedJson: "retained edits" };
  const retainedAd = { localImagePath: "reports/retained.webp", selectedForSlide: true, selectedForAnalysisEvidence: true };
  Object.assign(globalThis, { prisma: {
    brandReport: { update: async ({ data }: { data: object }) => Object.assign(retainedBrand, data) },
    adEvidence: { updateMany: async ({ data }: { data: object }) => { Object.assign(retainedAd, data); return { count: 1 }; } },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  } });
  const { markBrandAutomationSkipped } = await import("../lib/report-automation");
  await markBrandAutomationSkipped("brand");
  assert.equal(analysisWasSkipped(retainedBrand), true);
  assert.equal(retainedBrand.analysisJson, "retained previous analysis");
  assert.equal(retainedBrand.analysisEditedJson, "retained edits");
  assert.equal(retainedAd.localImagePath, "reports/retained.webp");
  assert.equal(retainedAd.selectedForSlide, false);
  assert.equal(retainedAd.selectedForAnalysisEvidence, false);
  console.log("Automation recovery, bounded retries, no duplicate POST, auth/abort, empty/partial evidence, and export readiness tests passed.");
}
main().finally(() => mock.restoreAll()).catch(error => { console.error(error); process.exitCode = 1; });
