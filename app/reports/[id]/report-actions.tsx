"use client";
import { deleteReport } from "../actions";
import ExportControls from "./export-controls";

export default function ReportActions({ reportId, blocked }: { reportId: string; blocked: boolean }) {
  return <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 p-4"><ExportControls reportId={reportId} blocked={blocked}/><form action={deleteReport.bind(null, reportId)} onSubmit={event => { if (!confirm("Delete this report and all of its evidence? This cannot be undone.")) event.preventDefault(); }}><button className="button button-secondary border-rose-200 text-rose-700 hover:bg-rose-50" type="submit">Delete report</button></form></div>;
}
