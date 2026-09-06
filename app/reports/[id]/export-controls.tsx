"use client";
import { useState } from "react";

export default function ExportControls({ reportId, blocked, processing, warnings }: { reportId: string; blocked: boolean; processing: boolean; warnings: string[] }) {
  const [cover, setCover] = useState(false);
  return <div className="grid w-full gap-4 sm:w-[42rem]"><div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600"><input className="h-4 w-4" type="checkbox" checked={cover} onChange={event => setCover(event.target.checked)}/>Cover slide</label>{processing ? <span className="text-sm font-medium text-indigo-700">Automated analysis is running. Export will be available when processing finishes.</span> : blocked ? <span className="text-sm font-medium text-rose-700">PowerPoint export is unavailable until the evidence issues below are resolved.</span> : <a className="button" href={`/api/reports/${reportId}/export${cover ? "?cover=1" : ""}`}>Export PowerPoint</a>}</div>{warnings.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p className="font-semibold">Report readiness issues:</p><ul className="mt-1 list-disc pl-5">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}</div>;
}
