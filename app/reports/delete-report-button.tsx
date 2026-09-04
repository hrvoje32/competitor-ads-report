"use client";
import { deleteReport } from "./actions";
export default function DeleteReportButton({ reportId }: { reportId: string }) { return <form className="inline" action={deleteReport.bind(null, reportId)} onSubmit={event => { if (!confirm("Delete this report and all of its evidence? This cannot be undone.")) event.preventDefault(); }}><button className="ml-4 font-semibold text-rose-700 hover:underline">Delete</button></form>; }
