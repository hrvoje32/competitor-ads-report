import { prisma } from "@/lib/prisma";
import { BackLink, EmptyState, PageHeader } from "../../components";
import { createReport } from "../actions";
import { months } from "@/lib/utils";
import ReportPeriodFields from "./report-period-fields";

export const dynamic = "force-dynamic";

export default async function NewReportPage() {
  const brands = await prisma.brand.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const now = new Date();
  if (!brands.length) return <>
    <BackLink href="/reports">Reports</BackLink>
    <PageHeader title="New monthly report"/>
    <EmptyState title="Add brands first" detail="A report needs at least one tracked brand."/>
  </>;

  return <>
    <BackLink href="/reports">Reports</BackLink>
    <PageHeader title="New monthly report" description="Choose the period and competitor brands to review."/>
    <form action={createReport} className="card max-w-3xl p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="md:col-span-2">
          <span className="label">Title *</span>
          <input name="title" required defaultValue={`${months[now.getMonth()]} ${now.getFullYear()} competitor advertising report`} />
        </label>
        <ReportPeriodFields initialMonth={now.getMonth() + 1} initialYear={now.getFullYear()}/>
      </div>
      <fieldset className="mt-7">
        <legend className="label">Include brands *</legend>
        <p className="mb-3 text-sm text-slate-500">Select the competitors to include in this report.</p>
        <div className="grid gap-3 sm:grid-cols-2">{brands.map(brand =>
          <label className="brand-option flex min-h-12 cursor-pointer items-center rounded-lg border border-slate-200 bg-white px-4 py-3 transition hover:border-teal-500 hover:bg-teal-50" key={brand.id}>
            <input type="checkbox" name="brandIds" value={brand.id} defaultChecked/>
            <span className="ml-3 font-medium text-slate-800">{brand.name}</span>
          </label>
        )}</div>
      </fieldset>
      <button className="button mt-7">Create report</button>
    </form>
  </>;
}
