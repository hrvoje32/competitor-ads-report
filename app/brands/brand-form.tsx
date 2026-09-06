"use client";

import type { Brand, GoogleAdvertiser, MetaPage } from "@prisma/client";
import { useActionState } from "react";
import type { BrandActionState } from "./actions";
import AdSourceFields from "./ad-source-fields";

type ConfiguredBrand = Brand & { googleAdvertisers: GoogleAdvertiser[]; metaPages: MetaPage[] };

type BrandFormAction = (state: BrandActionState, formData: FormData) => Promise<BrandActionState>;

export function BrandForm({ brand, action }: { brand?: ConfiguredBrand; action: BrandFormAction }) {
  const v = (key: keyof Brand) => brand?.[key] as string | number | null | undefined;
  const [state, formAction, pending] = useActionState(action, {});
  return <form action={formAction} className="card max-w-3xl p-6">
    <div className="grid gap-5 md:grid-cols-2">
      <label><span className="label">Brand name *</span><input name="name" defaultValue={v("name") ?? ""} required /></label>
      <label><span className="label">Logo</span><input name="logo" type="file" accept="image/*" /><span className="mt-1 block text-xs text-slate-400">Optional; optimized and saved locally.</span></label>
      <label><span className="label">Website</span><input name="websiteUrl" type="url" defaultValue={v("websiteUrl") ?? ""} placeholder="https://" /></label>
      <label><span className="label">Google Domain</span><input name="googleDomain" defaultValue={v("googleDomain") ?? ""} placeholder="example.com" /><span className="mt-1 block text-xs text-slate-400">Example: peugeot.hr. Full website URLs are also accepted.</span></label>
      <AdSourceFields brandName={String(v("name") ?? "")} initialAdvertisers={brand?.googleAdvertisers ?? []} initialMetaPages={brand?.metaPages ?? []} />
      <label><span className="label">Country</span><input name="countryCode" maxLength={2} defaultValue={v("countryCode") ?? "HR"} required /></label>
      <label><span className="label">Sort order</span><input name="sortOrder" type="number" defaultValue={v("sortOrder") ?? 0} /></label>
    </div>
    {state.error && <p role="alert" className="mt-5 rounded-md bg-rose-50 p-3 text-sm text-rose-800">{state.error}</p>}
    <div className="mt-7"><button className="button" disabled={pending}>{pending ? "Saving…" : brand ? "Save changes" : "Add brand"}</button></div>
  </form>;
}
