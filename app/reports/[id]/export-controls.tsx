"use client";
import { useState } from "react";

export default function ExportControls({ reportId, blocked }: { reportId: string; blocked: boolean }) {
  const [cover, setCover] = useState(false);
  return <div className="grid w-full items-center gap-4 sm:w-[32rem] sm:grid-cols-[auto_1fr]"><label className="flex items-center gap-2 whitespace-nowrap text-sm text-slate-600"><input className="h-4 w-4" type="checkbox" checked={cover} onChange={event => setCover(event.target.checked)}/>Cover slide</label>{blocked ? <span className="text-sm font-medium text-rose-700">Reduce analysis evidence to 3 per brand before exporting.</span> : <a className="button justify-self-start sm:justify-self-center" href={`/api/reports/${reportId}/export${cover ? "?cover=1" : ""}`}>Export PowerPoint</a>}</div>;
}
