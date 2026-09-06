"use client";

import { useState, useTransition } from "react";
import { cleanupReportMediaAction } from "../actions";

type Summary = {
  googleBytes: number;
  metaBytes: number;
  totalBytes: number;
  googleFiles: number;
  metaFiles: number;
  unknownSizeFiles: number;
  cleaned: boolean;
};

function size(value: number) {
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function ReportMediaControls({ reportId, language, summary, available }: {
  reportId: string;
  language: "HR" | "EN";
  summary: Summary;
  available: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const croatian = language === "HR";
  const confirmText = croatian
    ? "Time će se iz Supabase pohrane obrisati slike oglasa ovog izvještaja. Sačuvat će se analiza, podaci o oglasima i povijest izvještaja. Nakon brisanja neće biti moguće ponovno izvesti isti PowerPoint sa slikama bez ponovnog dohvaćanja oglasa. Nastaviti?"
    : "This deletes this report's ad images from Supabase Storage. Analysis, ad data, and report history will remain. The same PowerPoint cannot be exported with images again without fetching the ads again. Continue?";
  const clean = () => {
    if (!window.confirm(confirmText)) return;
    setMessage("");
    setError("");
    startTransition(async () => {
      try {
        const result = await cleanupReportMediaAction(reportId);
        if (result.failures) throw new Error(`${result.failures} media file(s) could not be deleted.`);
        setMessage(croatian ? `Obrisano datoteka: ${result.deletedFiles}.` : `Deleted files: ${result.deletedFiles}.`);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : (croatian ? "Čišćenje nije uspjelo." : "Cleanup failed."));
      }
    });
  };

  return <section className="card mb-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="font-bold">{croatian ? "Pohrana izvještaja" : "Report storage"}</p>
        {summary.cleaned ? <p className="mt-1 text-sm text-slate-600">{croatian ? "Pohrana medija: očišćena" : "Media storage: cleaned"}</p> : <div className="mt-1 text-sm text-slate-600">
          <p>{croatian ? "Google slike" : "Google images"}: {size(summary.googleBytes)} ({summary.googleFiles})</p>
          <p>{croatian ? "Meta slike" : "Meta images"}: {size(summary.metaBytes)} ({summary.metaFiles})</p>
          <p className="font-semibold">{croatian ? "Ukupno" : "Total"}: {size(summary.totalBytes)}</p>
          {summary.unknownSizeFiles > 0 && <p className="text-xs text-amber-700">{summary.unknownSizeFiles} {croatian ? "datoteka nema dostupnu veličinu" : "file sizes unavailable"}</p>}
        </div>}
      </div>
      {available && <button className="button button-secondary" disabled={pending} onClick={clean}>
        {pending ? (croatian ? "Čišćenje…" : "Cleaning…") : (croatian ? "Očisti medijske datoteke izvještaja" : "Clean Up Report Media")}
      </button>}
    </div>
    {message && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </section>;
}
