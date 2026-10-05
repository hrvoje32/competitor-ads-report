"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProviderSelection } from "@/lib/ad-providers/selection";
import { automationRequest, AutomationRequestError, monitorAutomation } from "@/lib/automation-client";
import ProviderFields from "./provider-fields";
import ExportControls from "./export-controls";
import DeleteReportButton from "../delete-report-button";

export default function ReportActions({ reportId, blocked, processing, warnings, hasFailures, initialProviders }: { reportId: string; blocked: boolean; processing: boolean; warnings: string[]; hasFailures: boolean; initialProviders: ProviderSelection }) {
  const router = useRouter();
  const [chosenProviders, setProviders] = useState<ProviderSelection | null>(null);
  const providers = chosenProviders ?? initialProviders;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const [monitoring, setMonitoring] = useState(false);
  const [progressNotice, setProgressNotice] = useState("");

  useEffect(() => {
    if ((!processing && !monitoring) || pending) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      monitorAutomation(`/api/reports/${reportId}/automate`, {
        signal: controller.signal,
        onRetry: setProgressNotice,
        onSnapshot: snapshot => {
          router.refresh();
          if (!snapshot.done) return;
          setMonitoring(false);
          const failures = snapshot.brands.filter(brand => brand.automationStatus === "FAILED")
            .map(brand => brand.automationError).filter((value): value is string => Boolean(value));
          setError([...new Set(failures)].join(" "));
        },
      }).catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof AutomationRequestError ? cause.message : "Progress checks stopped. Reopen this report to resume them.");
      });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pending, processing, monitoring, reportId, router]);

  const run = async (retryFailed = false) => {
    setPending(true);
    setError("");
    try {
      await automationRequest(`/api/reports/${reportId}/automate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retryFailed, providers }),
      });
      setMonitoring(true);
      router.refresh();
    } catch (cause) {
      if (cause instanceof AutomationRequestError && cause.retryable) {
        setProgressNotice("Could not confirm the start response. Checking existing progress; the start request will not be repeated.");
        setMonitoring(true);
      } else setError(cause instanceof AutomationRequestError ? cause.message : "Unable to start automated analysis. Reopen the report to check its status.");
    } finally {
      setPending(false);
      router.refresh();
    }
  };

  return <div className="card mb-6 grid gap-4 p-4">
    <ProviderFields value={providers} onChange={setProviders} disabled={pending || processing || monitoring}/>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-wrap gap-2">
        <button className="button" disabled={pending || processing || monitoring} onClick={() => run(false)}>{pending || processing || monitoring ? "Automated analysis running…" : "Run Automated Analysis"}</button>
        {hasFailures && <button className="button button-secondary" disabled={pending || processing || monitoring} onClick={() => run(true)}>Retry Failed</button>}
      </div>
      <DeleteReportButton reportId={reportId} redirectAfterDelete/>
    </div>
    {(processing || monitoring) && <p className="text-sm text-slate-600">Keep this report open while it runs. Brands without usable images will be skipped.</p>}
    {progressNotice && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{progressNotice}</p>}
    {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    <ExportControls reportId={reportId} blocked={blocked} processing={processing || pending || monitoring} warnings={warnings}/>
  </div>;
}
