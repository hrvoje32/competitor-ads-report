import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BackLink, EmptyState, PageHeader } from "../../components";
import { monthLabel } from "@/lib/utils";
import ReportActions from "./report-actions";
import BrandAutomationButton from "./brand-automation-button";
import { reportExportBlocked, reportExportWarnings } from "@/lib/report-readiness";
import { updateReportLanguage } from "../actions";
import { getReportMediaSummary } from "@/lib/report-media";
import ReportMediaControls from "./report-media-controls";
import { monthName } from "@/lib/month-comparison";

export const dynamic = "force-dynamic";

type StatusValue = "PENDING" | "FETCHING" | "CAPTURING" | "ANALYSING" | "READY" | "FAILED";
const statusClasses: Record<StatusValue, string> = {
  PENDING: "bg-slate-100 text-slate-600",
  FETCHING: "bg-sky-50 text-sky-700",
  CAPTURING: "bg-indigo-50 text-indigo-700",
  ANALYSING: "bg-violet-50 text-violet-700",
  READY: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-rose-50 text-rose-700",
};

function Status({ label, value }: { label: string; value: StatusValue }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusClasses[value]}`}>{label}: {value.toLowerCase()}</span>;
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await prisma.report.findUnique({
    where: { id },
    include: {
      brandReports: {
        where: { included: true },
        include: {
          brand: true,
          previousBrandReport: { include: { report: true } },
          adEvidence: true,
          providerRuns: true,
        },
        orderBy: { brand: { sortOrder: "asc" } },
      },
    },
  });
  if (!report) notFound();

  const exportBlocked = reportExportBlocked(report.brandReports);
  const automationInProgress = report.brandReports.some(brandReport =>
    ["FETCHING", "CAPTURING", "ANALYSING"].includes(brandReport.automationStatus)
  );
  const warnings = reportExportWarnings(report.brandReports);
  const hasFailures = report.brandReports.some(brandReport =>
    [brandReport.automationStatus, brandReport.googleStatus, brandReport.metaStatus].includes("FAILED")
  );
  const mediaSummary = await getReportMediaSummary(report.id);
  const cleanupAvailable = report.status === "COMPLETE" && report.brandReports.every(brandReport =>
    Boolean(brandReport.analysisJson || brandReport.analysisEditedJson)
  );

  return <>
    <BackLink href="/reports">Reports</BackLink>
    <PageHeader title={report.title} description={`${monthLabel(report.month, report.year)} · ${report.countryCode}`}/>
    <form action={updateReportLanguage.bind(null, report.id)} className="card mb-4 flex flex-wrap items-end gap-3 p-4">
      <label className="min-w-52">
        <span className="label">Report language</span>
        <select name="language" defaultValue={report.language}>
          <option value="HR">Croatian</option>
          <option value="EN">English</option>
        </select>
      </label>
      <button className="button button-secondary">Save language</button>
      <p className="text-sm text-slate-500">Changing language clears existing analysis so each brand can be regenerated in the selected language.</p>
    </form>
    <ReportMediaControls reportId={report.id} language={report.language} summary={mediaSummary} available={cleanupAvailable}/>
    <ReportActions reportId={id} blocked={exportBlocked} processing={automationInProgress} warnings={warnings} hasFailures={hasFailures}/>
    {report.brandReports.length ? <div className="grid gap-4">
      {report.brandReports.map(brandReport => {
        const google = brandReport.adEvidence.filter(item => item.source === "GOOGLE");
        const meta = brandReport.adEvidence.filter(item => item.source === "META");
        const googleSelected = google.filter(item => item.selectedForSlide).length;
        const metaSelected = meta.filter(item => item.selectedForSlide).length;
        const captured = brandReport.adEvidence.filter(item => item.captureStatus === "READY" || item.localImagePath).length;
        const captureFailed = brandReport.adEvidence.filter(item => item.captureStatus === "CAPTURE_FAILED").length;
        const googleRun = brandReport.providerRuns.find(run => run.source === "GOOGLE");
        const metaRun = brandReport.providerRuns.find(run => run.source === "META");
        const errors = [brandReport.googleError, brandReport.metaError, brandReport.googleMediaError, brandReport.metaMediaError, brandReport.automationError].filter((value): value is string => Boolean(value));
        const sourceSummary = (label: string, status: StatusValue, count: number, selected: number, run?: typeof googleRun) => {
          if (status === "FETCHING") return `${label}: Fetching through Apify…`;
          if (status === "CAPTURING") return `${label}: ${run?.itemCount ?? count} ads collected · storing media…`;
          if (status === "FAILED") return `${label}: Source failed`;
          return `${label}: ${run?.itemCount ?? count} ads collected · ${selected} representatives selected`;
        };

        return <article key={brandReport.id} className="card p-5">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-52 flex-1">
              <p className="font-bold">{brandReport.brand.name}</p>
              <p className="text-xs text-slate-500">{brandReport.brand.countryCode}</p>
              <div className="mt-3 grid gap-1 text-sm text-slate-600">
                <p>{sourceSummary("Google", brandReport.googleStatus, google.length, googleSelected, googleRun)}</p>
                <p>{sourceSummary("Meta", brandReport.metaStatus, meta.length, metaSelected, metaRun)}</p>
                <p>Media: {captured} evidence images stored{captureFailed ? ` / ${captureFailed} failed` : ""}</p>
                <p>Analysis: {brandReport.automationStatus === "ANALYSING" ? "running" : brandReport.automationStatus === "FAILED" ? "failed" : brandReport.analysisJson ? "ready" : "waiting"}</p>
                <p>Previous comparison: {brandReport.previousBrandReport ? monthName(brandReport.previousBrandReport.report.month, brandReport.previousBrandReport.report.year, "EN") : "None"}</p>
              </div>
            </div>
            <div className="flex max-w-xl flex-wrap gap-2">
              <Status label="Overall" value={brandReport.automationStatus}/>
              <Status label="Google" value={brandReport.googleStatus}/>
              <Status label="Meta" value={brandReport.metaStatus}/>
            </div>
          </div>
          {errors.length > 0 && <ul className="mt-3 list-disc rounded-md bg-rose-50 p-3 pl-8 text-sm text-rose-800">{[...new Set(errors)].map(error => <li key={error}>{error}</li>)}</ul>}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Link className="button button-secondary shrink-0" href={`/reports/${id}/brands/${brandReport.id}`}>Review Brand Report</Link>
            <BrandAutomationButton reportId={id} brandReportId={brandReport.id}/>
          </div>
        </article>;
      })}
    </div> : <EmptyState title="No included brands" detail="This report has no brands to review."/>}
  </>;
}
