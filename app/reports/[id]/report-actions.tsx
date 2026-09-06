"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ExportControls from "./export-controls";
import DeleteReportButton from "../delete-report-button";

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export default function ReportActions({ reportId, blocked, processing, warnings, hasFailures }: { reportId: string; blocked: boolean; processing: boolean; warnings: string[]; hasFailures: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const pollUntilDone = useCallback(async (signal?: AbortSignal) => {
    while (!signal?.aborted) {
      const response = await fetch(`/api/reports/${reportId}/automate`, { cache: "no-store", signal });
      const payload = await response.json() as { done?: boolean; error?: string; brands?: Array<{ automationError?: string | null }> };
      if (!response.ok) throw new Error(payload.error || "Unable to check automation status.");
      router.refresh();
      if (payload.done) {
        const failures = payload.brands?.map(brand => brand.automationError).filter((value): value is string => Boolean(value)) ?? [];
        if (failures.length) setError([...new Set(failures)].join(" "));
        return;
      }
      await wait(3_000);
    }
  }, [reportId, router]);

  useEffect(() => {
    if (!processing || pending) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      pollUntilDone(controller.signal).catch(cause => {
        if (cause instanceof Error && cause.name !== "AbortError") setError(cause.message);
      });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pending, pollUntilDone, processing]);

  const run = async (retryFailed = false) => {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${reportId}/automate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFailed }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to start automated analysis.");
      router.refresh();
      await pollUntilDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Automated analysis failed.");
    } finally {
      setPending(false);
      router.refresh();
    }
  };

  return <div className="card mb-6 grid gap-4 p-4">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-wrap gap-2">
        <button className="button" disabled={pending || processing} onClick={() => run(false)}>{pending || processing ? "Automated analysis running…" : "Run Automated Analysis"}</button>
        {hasFailures && <button className="button button-secondary" disabled={pending || processing} onClick={() => run(true)}>Retry Failed</button>}
      </div>
      <DeleteReportButton reportId={reportId} redirectAfterDelete/>
    </div>
    {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <ExportControls reportId={reportId} blocked={blocked} processing={processing} warnings={warnings}/>
  </div>;
}
