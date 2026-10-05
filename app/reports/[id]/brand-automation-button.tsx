"use client";

import type { ProviderSelection } from "@/lib/ad-providers/selection";
import { automationRequest, AutomationRequestError } from "@/lib/automation-client";
import ProviderFields from "./provider-fields";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function BrandAutomationButton({ reportId, brandReportId, initialProviders, processing }: { reportId: string; brandReportId: string; initialProviders: ProviderSelection; processing: boolean }) {
  const router = useRouter();
  const [chosenProviders, setProviders] = useState<ProviderSelection | null>(null);
  const providers = chosenProviders ?? initialProviders;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setPending(true);
    setError("");
    try {
      await automationRequest(`/api/reports/${reportId}/automate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandReportId, providers }),
      });
      // ReportActions owns the single report-wide progress loop.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof AutomationRequestError && !cause.retryable ? cause.message : "Could not confirm the start response. Checking existing progress; do not start another run.");
    } finally {
      setPending(false);
      router.refresh();
    }
  };

  return <div className="grid justify-items-end gap-1">
    <details className="max-w-md text-sm"><summary className="cursor-pointer text-right text-slate-600">Change collection sources</summary>
      <div className="py-3"><ProviderFields value={providers} onChange={setProviders} disabled={pending || processing}/></div>
    </details>
    <button className="button button-secondary shrink-0" disabled={pending || processing} onClick={run}>{pending ? "Processing…" : "Regenerate Brand"}</button>
    {error && <span className="max-w-64 text-right text-xs text-rose-700">{error}</span>}
  </div>;
}
