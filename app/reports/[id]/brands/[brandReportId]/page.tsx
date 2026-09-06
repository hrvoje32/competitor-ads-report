import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BackLink, EmptyState, PageHeader } from "../../../../components";
import EvidenceManager from "./evidence-manager";
import AnalysisManager from "./analysis-manager";
import { datedGoogleTransparencyUrl, isoReportDate, metaAdLibraryUrl } from "@/lib/report-period";
import { findPreviousCompletedBrandReport, monthName } from "@/lib/month-comparison";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BrandReportPage({ params, searchParams }: { params: Promise<{ id: string; brandReportId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id, brandReportId } = await params;
  const { tab = "google" } = await searchParams;
  const br = await prisma.brandReport.findFirst({
    where: { id: brandReportId, reportId: id },
    include: {
      brand: {
        include: {
          googleAdvertisers: { orderBy: { advertiserId: "asc" } },
          googleCandidates: { orderBy: { confidence: "desc" }, take: 5 },
          metaPages: { orderBy: { pageId: "asc" } },
        },
      },
      report: true,
      previousBrandReport: { include: { report: true } },
      adEvidence: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!br) notFound();
  const previous = br.previousBrandReport ?? await findPreviousCompletedBrandReport(br.brandId, br.report.year, br.report.month);
  const previousComparison = previous ? monthName(previous.report.month, previous.report.year, "EN") : null;
  const tabs = [{ key: "google", label: "GOOGLE ADS" }, { key: "social", label: "SOCIAL MEDIA ADS" }, { key: "analysis", label: "ANALYSIS" }];
  const evidence = br.adEvidence.filter(item => tab === "google" ? item.source === "GOOGLE" : item.source === "META");
  const analysisEvidenceCount = br.adEvidence.filter(item => item.selectedForAnalysisEvidence).length;
  const reportStartDate = isoReportDate(br.report.startDate);
  const reportEndDate = isoReportDate(br.report.endDate);
  const googleUrl = br.brand.googleDomain ? datedGoogleTransparencyUrl(br.report.countryCode, br.brand.googleDomain, br.report.startDate, br.report.endDate) : null;
  const metaPages = br.brand.metaPages.map(page => ({ pageId: page.pageId, pageName: page.pageName, url: metaAdLibraryUrl(br.report.countryCode, page.pageId) }));
  return <><BackLink href={`/reports/${id}`}>{br.report.title}</BackLink><PageHeader title={br.brand.name} description="Brand report workspace"/><p className="card mb-4 p-4 text-sm text-slate-600"><span className="font-semibold text-slate-900">Previous comparison:</span> {previousComparison ?? "None"}</p><div className="mb-5 flex overflow-x-auto border-b border-slate-200">{tabs.map(item => <Link key={item.key} href={`?tab=${item.key}`} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold ${tab === item.key ? "border-teal-700 text-teal-700" : "border-transparent text-slate-500"}`}>{item.label}</Link>)}</div>{tab === "analysis" ? <AnalysisManager reportId={id} brandReportId={br.id} generatedJson={br.analysisJson} editedJson={br.analysisEditedJson} analysisEvidenceCount={analysisEvidenceCount} language={br.report.language} previousComparison={previousComparison}/> : <EvidenceManager evidence={evidence} reportId={id} brandId={br.brandId} brandReportId={br.id} analysisEvidenceCount={analysisEvidenceCount} tab={tab === "google" ? "google" : "social"} googleInfo={tab === "google" ? { advertiserIds: br.brand.googleAdvertisers.map(item => item.advertiserId), candidates: br.brand.googleCandidates.map(item => ({ advertiserId: item.advertiserId, name: item.disclosedName || item.legalName, confidence: item.confidence, selected: item.selected })), domain: br.brand.googleDomain, transparencyUrl: googleUrl, region: br.report.countryCode, dateRange: `${reportStartDate} – ${reportEndDate}`, apifyConfigured: Boolean(process.env.APIFY_TOKEN) } : undefined} metaInfo={tab === "social" ? { pages: metaPages, region: br.report.countryCode, dateRange: `${reportStartDate} – ${reportEndDate}`, apifyConfigured: Boolean(process.env.APIFY_TOKEN), legacyConfigured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_GRAPH_API_VERSION) } : undefined}/>}</>;
}
