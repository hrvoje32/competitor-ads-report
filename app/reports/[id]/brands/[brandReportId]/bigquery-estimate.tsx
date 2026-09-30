"use client";

import { useState, useTransition } from "react";
import type { GoogleQueryEstimate } from "@/lib/google-ads-transparency";
import { estimateGoogleAdsForReport } from "./bigquery-estimate-actions";

const gib = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

export default function BigQueryEstimate({ reportId, brandId, brandReportId, disabled }: {
  reportId: string;
  brandId: string;
  brandReportId: string;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [estimate, setEstimate] = useState<GoogleQueryEstimate | null>(null);
  const [error, setError] = useState("");

  function estimateScan() {
    setEstimate(null);
    setError("");
    startTransition(async () => {
      try {
        const result = await estimateGoogleAdsForReport(reportId, brandId, brandReportId);
        if ("error" in result) setError(result.error);
        else setEstimate(result.estimate);
      } catch {
        setError("Unable to request a BigQuery estimate. Please retry.");
      }
    });
  }

  return <div className="mt-3">
    <button type="button" className="button button-secondary" disabled={disabled || pending} onClick={estimateScan}>
      {pending ? "Estimating…" : "Estimate BigQuery Cost"}
    </button>
    <p className="mt-2 text-xs text-slate-500">Estimates scan size without collecting ads. No query execution charge.</p>
    <div aria-live="polite" aria-busy={pending}>
      {error && <p className="mt-2 rounded-md bg-rose-50 p-3 text-rose-800" role="alert">{error}</p>}
      {estimate && <div className={`mt-2 space-y-1 rounded-md p-3 ${estimate.exceedsLimit ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}>
        <p><strong>Estimated scan:</strong> {gib(estimate.estimatedGiB)} GiB <span>({estimate.totalBytesProcessed} bytes)</span></p>
        <p><strong>Current query limit:</strong> {gib(estimate.limitGiB)} GiB <span>({estimate.maximumBytesBilled} bytes)</span></p>
        <p><strong>Status:</strong> {estimate.exceedsLimit ? "Query exceeds configured limit" : "Query is within configured limit"}</p>
        <p className="break-words"><strong>Advertiser IDs:</strong> {estimate.advertiserIds.join(", ")}</p>
        <p><strong>Country:</strong> {estimate.countryCode}</p>
        <p><strong>Date range:</strong> {estimate.startDate} – {estimate.endDate}</p>
        <p className="pt-1 text-xs">Estimate at the time of this check; actual bytes billed may differ.</p>
      </div>}
    </div>
  </div>;
}
