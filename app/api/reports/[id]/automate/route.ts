import { NextRequest } from "next/server";
import { POST as generateAnalysis } from "@/app/api/brand-reports/[brandReportId]/generate-analysis/route";
import { prisma } from "@/lib/prisma";
import {
  advanceBrandCollection,
  claimBrandAnalysis,
  groupAndSelectEvidence,
  markBrandAutomationFailed,
  markBrandAutomationReady,
  startBrandAutomation,
} from "@/lib/report-automation";

export const runtime = "nodejs";
export const maxDuration = 300;

type RequestBody = { brandReportId?: string; retryFailed?: boolean };

async function finishBrand(brandReportId: string) {
  try {
    const collection = await advanceBrandCollection(brandReportId);
    if (!collection.readyForAnalysis || collection.done) return;
    if (!await claimBrandAnalysis(brandReportId)) return;
    const selection = await groupAndSelectEvidence(brandReportId);
    if (!selection.analysis) throw new Error("No usable creatives were stored. Review source and media errors, then retry or upload fallback evidence.");
    const response = await generateAnalysis(
      new NextRequest(`http://localhost/api/brand-reports/${brandReportId}/generate-analysis`, { method: "POST" }),
      { params: Promise.resolve({ brandReportId }) },
    );
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error || "OpenAI generation failed.");
    await markBrandAutomationReady(brandReportId);
  } catch (error) {
    await markBrandAutomationFailed(brandReportId, error);
  }
}

async function reportSnapshot(reportId: string) {
  const brands = await prisma.brandReport.findMany({
    where: { reportId, included: true },
    orderBy: { brand: { sortOrder: "asc" } },
    select: {
      id: true,
      automationStatus: true,
      googleStatus: true,
      metaStatus: true,
      automationError: true,
      googleError: true,
      metaError: true,
      googleMediaError: true,
      metaMediaError: true,
      providerRuns: { select: { source: true, status: true, runId: true, itemCount: true, mediaStoredCount: true, error: true } },
    },
  });
  const done = brands.every(brand => !["FETCHING", "CAPTURING", "ANALYSING"].includes(brand.automationStatus));
  return { done, brands };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as RequestBody;
  const brandReports = await prisma.brandReport.findMany({
    where: {
      reportId: id,
      included: true,
      ...(body.brandReportId ? { id: body.brandReportId } : {}),
      ...(body.retryFailed && !body.brandReportId ? {
        OR: [
          { automationStatus: "FAILED" },
          { googleStatus: "FAILED" },
          { metaStatus: "FAILED" },
        ],
      } : {}),
    },
    orderBy: { brand: { sortOrder: "asc" } },
    select: { id: true },
  });
  if (body.brandReportId && !brandReports.length) return Response.json({ error: "Brand report not found." }, { status: 404 });
  const results = [];
  for (const brandReport of brandReports) {
    try {
      results.push(await startBrandAutomation(brandReport.id, { failedOnly: Boolean(body.retryFailed) }));
    } catch (error) {
      results.push({ brandReportId: brandReport.id, error: error instanceof Error ? error.message : "Unable to start automation." });
    }
  }
  await prisma.report.update({ where: { id }, data: { status: "DRAFT" } });
  return Response.json({ accepted: true, results }, { status: 202 });
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandReports = await prisma.brandReport.findMany({
    where: { reportId: id, included: true, automationStatus: { in: ["FETCHING", "CAPTURING", "ANALYSING"] } },
    select: { id: true },
  });
  if (!brandReports.length) {
    const report = await prisma.report.findUnique({ where: { id }, select: { id: true } });
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });
  }
  await Promise.allSettled(brandReports.map(brandReport => finishBrand(brandReport.id)));
  const snapshot = await reportSnapshot(id);
  if (snapshot.done) {
    const failed = snapshot.brands.some(brand => brand.automationStatus === "FAILED");
    await prisma.report.update({ where: { id }, data: { status: failed ? "DRAFT" : "COMPLETE" } });
  }
  return Response.json(snapshot);
}
