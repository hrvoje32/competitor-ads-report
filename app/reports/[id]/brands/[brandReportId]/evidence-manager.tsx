"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import CropDialog from "./crop-dialog";
import { browserFileUrl } from "@/lib/file-url";
import { addEvidence, attachGoogleScreenshot, attachMetaScreenshot, deleteEvidence, fetchGoogleAds, fetchMetaAdsForReport, moveEvidence, setAllSlideSelections, setAnalysisSelection, setSlideSelection, tryAutomaticCapture, updateEvidence } from "./actions";

type Evidence = { id: string; externalId: string | null; localImagePath: string | null; headline: string | null; body: string | null; sourceUrl: string | null; snapshotUrl: string | null; platform: string | null; format: string | null; notes: string | null; firstShown: Date | null; lastShown: Date | null; selectedForSlide: boolean; selectedForAnalysisEvidence: boolean; captureStatus: "PENDING" | "CAPTURING" | "READY" | "CAPTURE_FAILED"; captureError: string | null; duplicateGroupCount: number; representativeScore: number | null };
type Props = { evidence: Evidence[]; reportId: string; brandId: string; brandReportId: string; analysisEvidenceCount: number; tab: "google" | "social"; googleInfo?: { advertiserIds: string[]; candidates: Array<{ advertiserId: string; name: string | null; confidence: number; selected: boolean }>; domain: string | null; transparencyUrl: string | null; region: string; dateRange: string; apifyConfigured: boolean }; metaInfo?: { pages: Array<{ pageId: string; pageName: string | null; url: string }>; region: string; dateRange: string; apifyConfigured: boolean; legacyConfigured: boolean } };
type Result = { error?: string; fetched?: number; capturedEvidenceId?: string } | void;
const date = (value: Date | null) => value ? new Date(value).toISOString().slice(0, 10) : "";
const name = (tab: Props["tab"]) => tab === "google" ? "Google" : "Social";
function importedMeta(notes: string | null) { try { const value = JSON.parse(notes ?? "") as { importedFrom?: string; pageName?: string; euReach?: { lower?: number | null; upper?: number | null } }; return value.importedFrom === "meta" ? value : null; } catch { return null; } }

export default function EvidenceManager({ evidence, reportId, brandId, brandReportId, analysisEvidenceCount, tab, googleInfo, metaInfo }: Props) {
  const router = useRouter();
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [editing, setEditing] = useState<string | null>(null); const [cropId, setCropId] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  const cropItem = evidence.find(item => item.id === cropId);
  const run = (work: () => Promise<Result>) => startTransition(async () => { const result = await work(); setError(result?.error ?? ""); setNotice(result?.fetched === undefined ? "" : `${result.fetched} ${tab === "google" ? "Google" : "Meta"} records fetched.`); router.refresh(); });
  const capture = (evidenceId: string) => startTransition(async () => { setError(""); setNotice(""); const result = await tryAutomaticCapture(reportId, brandId, brandReportId, evidenceId); if (result.error) setError(result.error); else { setCropId(evidenceId); setNotice("Screenshot captured. Adjust the crop if needed."); } router.refresh(); });
  const testMeta = async () => { const response = await fetch("/api/meta/test-connection", { method: "POST" }); const result = await response.json() as { ok?: boolean; error?: string }; setError(result.ok ? "" : result.error ?? "Meta connection failed."); setNotice(result.ok ? "Meta connection successful." : ""); };
  const imported = evidence.filter(item => item.externalId).length;
  return <>
    {tab === "google" && <section className="card mb-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Google Ads Transparency Center</h2><p className="mt-1 text-sm text-slate-500">Domain: {googleInfo?.domain || "Not configured"} · Region: {googleInfo?.region} · Date range: {googleInfo?.dateRange}</p></div>{googleInfo?.transparencyUrl ? <a className="button button-secondary" href={googleInfo.transparencyUrl} target="_blank" rel="noreferrer">Open Google Ads Transparency</a> : <button className="button button-secondary" disabled>Open Google Ads Transparency</button>}</div>{!googleInfo?.domain && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Google Domain is required for automated Apify collection.</p>}{!googleInfo?.apifyConfigured && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Apify is not configured. Set APIFY_TOKEN or use manual evidence.</p>}<p className="mt-3 text-sm text-slate-600">{imported} Google records collected. Creative images and reconstructed text-ad cards are stored automatically.</p><details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">Legacy BigQuery tools</summary><div className="mt-2 flex flex-wrap items-center gap-2"><span>Advertiser IDs: {googleInfo?.advertiserIds.length ? googleInfo.advertiserIds.join(", ") : "Not configured"}</span><button className="button button-secondary" disabled={pending || !googleInfo?.advertiserIds.length} onClick={() => run(() => fetchGoogleAds(reportId, brandId, brandReportId))}>Legacy Google import</button></div></details></section>}
    {tab === "social" && <section className="card mb-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Meta Ad Library</h2><p className="mt-1 text-sm text-slate-500">Pages: {metaInfo?.pages.length ? metaInfo.pages.map(page => page.pageName || page.pageId).join(", ") : "Not configured"} · Region: {metaInfo?.region} · Date range: {metaInfo?.dateRange}</p></div><div className="flex flex-wrap gap-2">{metaInfo?.pages.map((page, index) => <a key={page.pageId} className="button button-secondary" href={page.url} target="_blank" rel="noreferrer">Open Meta Ad Library{metaInfo.pages.length > 1 ? ` ${index + 1}` : ""}</a>)}</div></div>{!metaInfo?.pages.length && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Meta Page IDs are required for automated Apify collection.</p>}{!metaInfo?.apifyConfigured && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">Apify is not configured. Set APIFY_TOKEN or use manual evidence.</p>}<p className="mt-3 text-sm text-slate-600">{imported} Meta records collected. Available creative media is stored automatically.</p><details className="mt-3 text-sm text-slate-600"><summary className="cursor-pointer font-semibold">Legacy Meta API tools</summary><div className="mt-2 flex flex-wrap gap-2"><button className="button button-secondary" disabled={!metaInfo?.legacyConfigured} onClick={testMeta}>Test legacy connection</button><button className="button button-secondary" disabled={pending || !metaInfo?.legacyConfigured || !metaInfo.pages.length} onClick={() => run(() => fetchMetaAdsForReport(reportId, brandId, brandReportId))}>Legacy Meta import</button></div></details></section>}
    <section className="card p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-bold">Manual {name(tab)} evidence</h2><p className="mt-1 text-sm text-slate-500">Manual uploads remain available whether or not an API is configured.</p></div><div className="flex gap-2"><button className="button button-secondary" onClick={() => run(() => setAllSlideSelections(reportId, brandId, brandReportId, tab, true))}>Select all</button><button className="button button-secondary" onClick={() => run(() => setAllSlideSelections(reportId, brandId, brandReportId, tab, false))}>Clear selection</button></div></div><form className="mt-5 grid gap-3" action={formData => run(() => addEvidence(reportId, brandId, brandReportId, tab, formData))}><input name="images" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple required/><div className="grid gap-3 sm:grid-cols-2"><input name="headline" placeholder="Headline (optional)"/><input name="sourceUrl" type="url" placeholder="Source URL (optional)"/><input name="platform" placeholder="Platform (optional)"/><input name="format" placeholder="Format (optional)"/><input name="firstShown" type="date"/><input name="lastShown" type="date"/></div><textarea name="body" placeholder="Body (optional)"/><textarea name="notes" placeholder="Notes (optional)"/><button className="button w-fit" disabled={pending}>Add {name(tab)} Evidence</button></form></section>
    {error && <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}{notice && <p className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <p className="mt-4 text-sm text-slate-500">{evidence.filter(item => item.selectedForSlide).length} of 8 selected for this slide. {analysisEvidenceCount} of 3 selected for analysis.</p>
    <div className="mt-3 grid gap-4 lg:grid-cols-2">{evidence.map((item, index) => <EvidenceCard key={item.id} item={item} index={index} total={evidence.length} analysisEvidenceCount={analysisEvidenceCount} tab={tab} reportId={reportId} brandId={brandId} brandReportId={brandReportId} run={run} pending={pending} editing={editing === item.id} toggleEdit={() => setEditing(editing === item.id ? null : item.id)} onCapture={capture} onCrop={() => setCropId(item.id)}/>)}</div>
    {!evidence.length && <div className="card mt-4 p-8 text-center text-sm text-slate-500">No evidence yet. Add images above or fetch available records.</div>}
    {cropItem?.localImagePath && <CropDialog imagePath={browserFileUrl(cropItem.localImagePath)} reportId={reportId} brandReportId={brandReportId} evidenceId={cropItem.id} onClose={() => setCropId(null)}/>}
  </>;
}

type CardProps = { item: Evidence; index: number; total: number; analysisEvidenceCount: number; tab: Props["tab"]; reportId: string; brandId: string; brandReportId: string; run: (work: () => Promise<Result>) => void; pending: boolean; editing: boolean; toggleEdit: () => void; onCapture: (id: string) => void; onCrop: () => void };
function EvidenceCard({ item, index, total, analysisEvidenceCount, tab, reportId, brandId, brandReportId, run, pending, editing, toggleEdit, onCapture, onCrop }: CardProps) {
  const meta = importedMeta(item.notes);
  const attach = (formData: FormData) => tab === "google"
    ? attachGoogleScreenshot(reportId, brandId, brandReportId, item.id, formData)
    : attachMetaScreenshot(reportId, brandId, brandReportId, item.id, formData);
  const sourceUrl = item.snapshotUrl || item.sourceUrl;
  const analysisSelectionDisabled = !item.localImagePath || !item.selectedForSlide || (!item.selectedForAnalysisEvidence && analysisEvidenceCount >= 3);

  return <article className="card overflow-hidden">
    <div className="flex gap-4 p-4">
      {item.localImagePath ? <Image src={browserFileUrl(item.localImagePath)} alt={item.headline || "Advertising evidence"} width={144} height={112} className="h-28 w-36 rounded-md object-cover"/> : <div className="grid h-28 w-36 place-items-center rounded-md bg-amber-50 p-2 text-center text-xs font-semibold text-amber-800">{item.externalId ? "Screenshot required" : "No image"}</div>}
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">{item.headline || "Untitled evidence"}</h3>
        {meta?.pageName && <p className="text-xs text-slate-500">Page: {meta.pageName}</p>}
        {item.externalId && <p className="text-xs text-slate-500">ID: {item.externalId}</p>}
        {item.body && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{item.body}</p>}
        <p className="mt-2 text-xs text-slate-500">{item.platform || "Platform not specified"}{item.format ? ` · ${item.format}` : ""}</p>
        <p className="text-xs text-slate-500">{date(item.firstShown) || "No start date"}{item.lastShown ? ` – ${date(item.lastShown)}` : ""}</p>
        {item.duplicateGroupCount > 1 && <p className="text-xs font-semibold text-teal-700">{item.duplicateGroupCount} related ads in this creative group</p>}
        {item.captureStatus === "CAPTURING" && <p className="text-xs font-semibold text-indigo-700">Creative capture in progress</p>}
        {item.captureStatus === "CAPTURE_FAILED" && <p className="text-xs font-semibold text-rose-700">Capture failed{item.captureError ? `: ${item.captureError}` : ""}</p>}
        {meta?.euReach?.lower !== null && meta?.euReach?.lower !== undefined && <p className="text-xs text-slate-500">EU reach: {meta.euReach.lower}{meta.euReach.upper ? `–${meta.euReach.upper}` : "+"}</p>}
      </div>
    </div>
    <div className="border-t border-slate-100 p-4">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input className="h-4 w-4" type="checkbox" disabled={!item.localImagePath} checked={item.selectedForSlide} onChange={event => run(() => setSlideSelection(reportId, brandId, brandReportId, item.id, event.target.checked))}/>Include on {name(tab)} slide</label>
        <label className="flex items-center gap-2"><input className="h-4 w-4" type="checkbox" disabled={analysisSelectionDisabled} checked={item.selectedForAnalysisEvidence} onChange={event => run(() => setAnalysisSelection(reportId, brandReportId, item.id, event.target.checked))}/>Use as analysis evidence</label>
      </div>
      {editing && <form className="mt-3 grid gap-2" action={formData => run(() => updateEvidence(reportId, brandReportId, item.id, formData))}><input name="headline" defaultValue={item.headline ?? ""}/><textarea name="body" defaultValue={item.body ?? ""}/><input name="sourceUrl" defaultValue={item.sourceUrl ?? ""}/><input name="platform" defaultValue={item.platform ?? ""}/><input name="format" defaultValue={item.format ?? ""}/><input name="firstShown" type="date" defaultValue={date(item.firstShown)}/><input name="lastShown" type="date" defaultValue={date(item.lastShown)}/><textarea name="notes" defaultValue={item.notes ?? ""}/><button className="button w-fit">Save evidence</button></form>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.externalId && !item.localImagePath && <form action={formData => run(() => attach(formData))} className="flex items-center gap-2"><input className="max-w-48" name="screenshot" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" required/><button className="button button-secondary">Add Screenshot</button></form>}
        {sourceUrl && <button className="button button-secondary" disabled={pending} onClick={() => onCapture(item.id)}>Try Automatic Capture</button>}
        {item.localImagePath && <button className="button button-secondary" onClick={onCrop}>Crop</button>}
        <button className="button button-secondary" onClick={toggleEdit}>Edit</button>
        <button className="button button-secondary" disabled={index === 0} onClick={() => run(async () => { await moveEvidence(reportId, brandId, brandReportId, item.id, "previous"); })}>Move left/up</button>
        <button className="button button-secondary" disabled={index === total - 1} onClick={() => run(async () => { await moveEvidence(reportId, brandId, brandReportId, item.id, "next"); })}>Move right/down</button>
        {sourceUrl && <a className="button button-secondary" href={sourceUrl} target="_blank" rel="noreferrer">{tab === "social" ? "Open Ad Snapshot" : "Open Creative"}</a>}
        <button className="ml-auto text-sm font-bold text-rose-700" onClick={() => { if (confirm("Delete this evidence record?")) run(() => deleteEvidence(reportId, brandReportId, item.id)); }}>Delete</button>
      </div>
    </div>
  </article>;
}
