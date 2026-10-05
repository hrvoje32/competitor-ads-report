import { finishBrandAutomation } from "@/lib/finish-brand-automation";
import { automationRequestSchema } from "@/lib/ad-providers/selection";
import { NextRequest } from "next/server";
import { POST as generateAnalysis } from "@/app/api/brand-reports/[brandReportId]/generate-analysis/route";
import { prisma } from "@/lib/prisma";
import {
  advanceBrandCollection,
  claimBrandAnalysis,
  groupAndSelectEvidence,
  markBrandAutomationFailed,
  markBrandAutomationReady,
  markBrandAutomationSkipped,
  startBrandAutomation,
} from "@/lib/report-automation";

export const runtime = "nodejs";
export const maxDuration = 300;

async function finishBrand(brandReportId: string) {
  return finishBrandAutomation(brandReportId, {
    advance: advanceBrandCollection,
    claim: claimBrandAnalysis,
    select: groupAndSelectEvidence,
    generate: id => generateAnalysis(
      new NextRequest(`http://localhost/api/brand-reports/${id}/generate-analysis`, { method: "POST" }),
      { params: Promise.resolve({ brandReportId: id }) },
    ),
    ready: markBrandAutomationReady,
    skipped: markBrandAutomationSkipped,
    failed: markBrandAutomationFailed,
  });
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
      providerRuns: { select: { provider: true, source: true, status: true, runId: true, itemCount: true, mediaStoredCount: true, error: true } },
    },
  });
  const done = brands.every(brand => !["FETCHING", "CAPTURING", "ANALYSING"].includes(brand.automationStatus));
  return { done, brands };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = automationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid collection settings." }, { status: 400 });
  const body = parsed.data;
  const report = await prisma.report.findUnique({ where: { id }, select: { id: true } });
  if (!report) return Response.json({ error: "Report not found." }, { status: 404 });
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
    select: { id: true, automationStatus: true },
  });
  if (body.brandReportId && !brandReports.length) return Response.json({ error: "Brand report not found." }, { status: 404 });
  if (brandReports.some(brand => ["FETCHING", "CAPTURING", "ANALYSING"].includes(brand.automationStatus))) {
    return Response.json({ error: "Collection is already running. Wait for it to finish before changing sources." }, { status: 409 });
  }
  const results = [];
  for (const brandReport of brandReports) {
    try {
      results.push(await startBrandAutomation(brandReport.id, { failedOnly: Boolean(body.retryFailed), providers: body.providers }));
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
    // Bound each request; rotate through brands instead of processing every
    // brand concurrently within one Vercel invocation.
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 3,
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
