import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { refreshBrandEvidence } from "@/lib/brand-evidence";
import { hasUsableScreenshot } from "@/lib/brand-ad-filter";
import { capturePublicPage } from "@/lib/automatic-capture";
import { storeProviderImage } from "@/lib/ad-media";
import { deleteLocalUpload } from "@/lib/uploads";
import { safeCaptureText } from "@/lib/browser/diagnostics";
import { captureBudgetOpen, MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE, MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE, nextCaptureCandidate } from "@/lib/official-capture-policy";
import type { AdSource } from "@prisma/client";

export const officialCaptureServices = { capture: capturePublicPage, store: storeProviderImage };

// One attempt per call, shared by automation and manual official capture.
// Reserve before opening Browserless: failures, crashes, and storage errors all
// consume one attempt. A unique lease prevents overlapping polls from spending
// the same slot; releasing an expired lease cannot release its successor.
export async function captureOfficialCandidate(brandReportId: string, source: AdSource, requestedId?: string) {
  const key = { brandReportId_source: { brandReportId, source } };
  await prisma.officialCaptureState.upsert({ where: key, create: { brandReportId, source }, update: {} });
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.officialCaptureState.updateMany({ where: {
    brandReportId, source, OR: [{ leaseToken: null }, { leaseStartedAt: { lt: new Date(Date.now() - 5 * 60_000) } }],
  }, data: { leaseToken, leaseStartedAt: new Date() } });
  if (!claimed.count) return { busy: true, error: "Capture is already in progress for this source." };
  let evidenceId: string | undefined, captureUrl: string | undefined, uploadedPath: string | undefined;
  try {
    await prisma.adEvidence.updateMany({ where: { brandReportId, source, captureStatus: "CAPTURING", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, data: { captureStatus: "CAPTURE_FAILED", captureError: "Previous capture timed out; its attempt remains counted." } });
    const evidence = (await refreshBrandEvidence(brandReportId)).filter(item => item.source === source);
    const state = await prisma.officialCaptureState.findUniqueOrThrow({ where: key });
    const stored = evidence.filter(hasUsableScreenshot).length;
    const requested = requestedId ? evidence.find(item => item.id === requestedId) : undefined;
    if (requested && hasUsableScreenshot(requested)) return { capturedEvidenceId: requested.id, fallback: requested.captureMethod === "PAGE_FALLBACK" };
    if (!captureBudgetOpen(state.attempts, stored)) return { done: true, error: `Official capture limit reached (${stored}/${MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE} stored; ${state.attempts}/${MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE} attempts). Existing evidence is preserved.` };
    const next = nextCaptureCandidate(evidence, state.attempts, stored);
    if (requestedId && requestedId !== next?.id) return { error: "This ad is excluded, duplicated, already attempted, or not the next ranked candidate. Use the next capture candidate or upload a screenshot." };
    if (!next) return { done: true };
    captureUrl = next.snapshotUrl || next.sourceUrl || undefined;
    if (process.env.VERCEL && !process.env.BROWSER_WS_ENDPOINT) {
      await prisma.adEvidence.update({ where: { id: next.id }, data: { captureStatus: "CAPTURE_FAILED", captureError: "Browserless is not configured. Upload a screenshot or configure browser capture." } });
      return { done: true, error: "Browserless is not configured." };
    }
    // The source lease covers selection and the transactional reservation.
    await prisma.$transaction(async tx => {
      const reserved = await tx.officialCaptureState.updateMany({ where: { brandReportId, source, leaseToken, attempts: { lt: MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE } }, data: { attempts: { increment: 1 } } });
      if (!reserved.count) throw new Error("Capture budget or lease is no longer available.");
      await tx.adEvidence.update({ where: { id: next.id }, data: { captureStatus: "CAPTURING", captureError: null, officialCaptureAttemptedAt: new Date() } });
    });
    evidenceId = next.id;
    const capture = await officialCaptureServices.capture(captureUrl!, source);
    const report = await prisma.brandReport.findUniqueOrThrow({ where: { id: brandReportId }, include: { report: true } });
    const storedImage = await officialCaptureServices.store(capture.image, report.report, report.brandId, source, next.externalId || next.id, capture.contentType);
    uploadedPath = storedImage.path;
    await prisma.$transaction(async tx => {
      const held = await tx.officialCaptureState.updateMany({ where: { brandReportId, source, leaseToken }, data: { leaseStartedAt: new Date() } });
      if (!held.count) throw new Error("Capture lease expired before storage completed.");
      const count = await tx.adEvidence.count({ where: { brandReportId, source, localImagePath: { not: null } } });
      if (count >= MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE) throw new Error("Screenshot limit reached before storage completed.");
      await tx.adEvidence.update({ where: { id: next.id }, data: {
        localImagePath: storedImage.path, storedMediaBytes: storedImage.byteSize, captureStatus: "READY", captureError: null,
        captureMethod: capture.method, selectedForSlide: true,
      } });
    });
    uploadedPath = undefined;
    return { capturedEvidenceId: next.id, fallback: capture.method === "PAGE_FALLBACK" };
  } catch (error) {
    if (uploadedPath) await deleteLocalUpload(uploadedPath).catch(() => undefined);
    const message = safeCaptureText(error instanceof Error ? error.message : "Creative capture failed.", captureUrl);
    if (evidenceId) await prisma.adEvidence.updateMany({ where: { id: evidenceId, captureStatus: "CAPTURING" }, data: { captureStatus: "CAPTURE_FAILED", captureError: message } });
    return { error: message };
  } finally {
    await prisma.officialCaptureState.updateMany({ where: { brandReportId, source, leaseToken }, data: { leaseToken: null, leaseStartedAt: null } });
  }
}
