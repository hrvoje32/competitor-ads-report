"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteReport } from "./actions";

export default function DeleteReportButton({ reportId, redirectAfterDelete = false }: { reportId: string; redirectAfterDelete?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const remove = () => {
    if (!confirm("Delete this report and all of its evidence? This cannot be undone.")) return;
    setError("");
    startTransition(async () => {
      try {
        const result = await deleteReport(reportId);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (redirectAfterDelete) router.push("/reports");
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The report could not be deleted.");
      }
    });
  };
  return <div className={`${redirectAfterDelete ? "" : "ml-4"} grid justify-items-end gap-1`}>
    <button type="button" disabled={pending} onClick={remove} className={redirectAfterDelete ? "button button-secondary border-rose-200 text-rose-700 hover:bg-rose-50" : "font-semibold text-rose-700 hover:underline disabled:cursor-wait disabled:opacity-60"}>{pending ? "Deleting…" : redirectAfterDelete ? "Delete report" : "Delete"}</button>
    {error && <span className="max-w-72 text-right text-xs text-rose-700">{error}</span>}
  </div>;
}
