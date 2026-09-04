import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BackLink, EmptyState, PageHeader } from "../../../../components";
import EvidenceManager from "./evidence-manager";
import AnalysisManager from "./analysis-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function BrandReportPage({ params, searchParams }: { params: Promise<{ id: string; brandReportId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id, brandReportId } = await params;
  const { tab = "google" } = await searchParams;
  const br = await prisma.brandReport.findFirst({ where: { id: brandReportId, reportId: id }, include: { brand: true, report: true, adEvidence: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } } });
  if (!br) notFound();
  const tabs = [{ key: "google", label: "GOOGLE ADS" }, { key: "social", label: "SOCIAL MEDIA ADS" }, { key: "analysis", label: "ANALYSIS" }];
  const evidence = br.adEvidence.filter(item => tab === "google" ? item.source === "GOOGLE" : item.source === "META");
  const analysisEvidenceCount = br.adEvidence.filter(item => item.selectedForAnalysisEvidence).length;
  const start = `${br.report.year}-${String(br.report.month).padStart(2, "0")}-01`, end = new Date(Date.UTC(br.report.year, br.report.month, 0)).toISOString().slice(0, 10);
  return <><BackLink href={`/reports/${id}`}>{br.report.title}</BackLink><PageHeader title={br.brand.name} description="Brand report workspace"/><div className="mb-5 flex overflow-x-auto border-b border-slate-200">{tabs.map(item => <Link key={item.key} href={`?tab=${item.key}`} className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold ${tab === item.key ? "border-teal-700 text-teal-700" : "border-transparent text-slate-500"}`}>{item.label}</Link>)}</div>{tab === "analysis" ? <AnalysisManager reportId={id} brandReportId={br.id} generatedJson={br.analysisJson} editedJson={br.analysisEditedJson} analysisEvidenceCount={analysisEvidenceCount}/> : <EvidenceManager evidence={evidence} reportId={id} brandId={br.brandId} brandReportId={br.id} tab={tab === "google" ? "google" : "social"} googleInfo={tab === "google" ? { advertiserId: br.brand.googleAdvertiserId, region: br.report.countryCode, dateRange: `${start} – ${end}` } : undefined} metaInfo={tab === "social" ? { pageId: br.brand.metaPageId, region: br.report.countryCode, dateRange: `${start} – ${end}`, configured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_GRAPH_API_VERSION) } : undefined}/>}</>;
}
