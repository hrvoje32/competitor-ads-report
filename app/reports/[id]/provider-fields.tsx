"use client";

import type { ProviderSelection } from "@/lib/ad-providers/selection";

export default function ProviderFields({ value, onChange, disabled }: {
  value: ProviderSelection; onChange: (value: ProviderSelection) => void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="grid gap-2 sm:grid-cols-2">
    <legend className="mb-2 text-sm font-bold">Collection sources for this run</legend>
    <label><span className="label">Google ads</span><select value={value.GOOGLE} onChange={event => onChange({ ...value, GOOGLE: event.target.value as ProviderSelection["GOOGLE"] })}>
      <option value="APIFY">Apify (recommended)</option><option value="OFFICIAL">Google BigQuery</option>
    </select></label>
    <label><span className="label">Meta ads</span><select value={value.META} onChange={event => onChange({ ...value, META: event.target.value as ProviderSelection["META"] })}>
      <option value="APIFY">Apify (recommended)</option><option value="OFFICIAL">Meta Ad Library API</option>
    </select></label>
    <p className="text-xs text-slate-500 sm:col-span-2">Choose each source independently. Apify collects up to 20 candidates and stores up to 5 creative images or video thumbnails per source. Matching completed collections are reused. Official sources remain available with browser capture. Apify may incur charges.</p>
  </fieldset>;
}
