"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const wait = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds));

export default function BrandAutomationButton({ reportId, brandReportId }: { reportId: string; brandReportId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const run = async () => {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/reports/${reportId}/automate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandReportId }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Unable to start brand automation.");
      router.refresh();
      while (true) {
        const statusResponse = await fetch(`/api/reports/${reportId}/automate`, { cache: "no-store" });
        const status = await statusResponse.json() as { done?: boolean; error?: string; brands?: Array<{ id: string; automationStatus: string; automationError?: string | null }> };
        if (!statusResponse.ok) throw new Error(status.error || "Unable to check automation status.");
        const brand = status.brands?.find(item => item.id === brandReportId);
        router.refresh();
        if (brand && !["PENDING", "FETCHING", "CAPTURING", "ANALYSING"].includes(brand.automationStatus)) {
          if (brand.automationError) setError(brand.automationError);
          break;
        }
        await wait(3_000);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Brand automation failed.");
    } finally {
      setPending(false);
      router.refresh();
    }
  };

  return <div className="grid justify-items-end gap-1">
    <button className="button button-secondary shrink-0" disabled={pending} onClick={run}>{pending ? "Processing…" : "Regenerate Brand"}</button>
    {error && <span className="max-w-64 text-right text-xs text-rose-700">{error}</span>}
  </div>;
}
