"use client";

import { useState } from "react";
import { reportPeriod } from "@/lib/report-period";
import { months } from "@/lib/utils";

export default function ReportPeriodFields({ initialMonth, initialYear }: { initialMonth: number; initialYear: number }) {
  const initialPeriod = reportPeriod(initialYear, initialMonth);
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(String(initialYear));
  const [startDate, setStartDate] = useState(initialPeriod.startDate);
  const [endDate, setEndDate] = useState(initialPeriod.endDate);
  const [overridden, setOverridden] = useState(false);

  const updateDefaults = (nextMonth: number, nextYear: number) => {
    if (overridden || !Number.isInteger(nextYear) || nextYear < 2020 || nextYear > 2100) return;
    const period = reportPeriod(nextYear, nextMonth);
    setStartDate(period.startDate);
    setEndDate(period.endDate);
  };

  return <>
    <label>
      <span className="label">Month *</span>
      <select name="month" value={month} onChange={event => {
        const nextMonth = Number(event.target.value);
        setMonth(nextMonth);
        updateDefaults(nextMonth, Number(year));
      }}>{months.map((item, index) => <option key={item} value={index + 1}>{item}</option>)}</select>
    </label>
    <label>
      <span className="label">Year *</span>
      <input name="year" type="number" min="2020" max="2100" value={year} onChange={event => {
        setYear(event.target.value);
        updateDefaults(month, Number(event.target.value));
      }} required />
    </label>
    <label>
      <span className="label">Country *</span>
      <input name="countryCode" maxLength={2} defaultValue="HR" required />
    </label>
    <label>
      <span className="label">Language *</span>
      <select name="language" defaultValue="HR">
        <option value="HR">Croatian</option>
        <option value="EN">English</option>
      </select>
    </label>
    <fieldset className="rounded-lg border border-slate-200 p-4 md:col-span-2">
      <legend className="px-1 text-sm font-bold text-slate-800">Analysis period</legend>
      <p className="mb-3 text-sm text-slate-500">The core-month dates are filled automatically. You can edit them for this report.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>
          <span className="label">Start date *</span>
          <input name="startDate" type="date" value={startDate} onChange={event => { setStartDate(event.target.value); setOverridden(true); }} required />
        </label>
        <label>
          <span className="label">End date *</span>
          <input name="endDate" type="date" value={endDate} onChange={event => { setEndDate(event.target.value); setOverridden(true); }} required />
        </label>
      </div>
    </fieldset>
  </>;
}
