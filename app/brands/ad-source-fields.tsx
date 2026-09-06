"use client";

import { useRef, useState } from "react";

type Advertiser = { id: string; advertiserId: string; label: string | null };
type MetaPage = { id: string; pageId: string; pageName: string | null };
type SearchResult = { advertiserId: string; disclosedName: string | null; legalName: string | null; location: string | null };

export default function AdSourceFields({ brandName, initialAdvertisers, initialMetaPages }: { brandName: string; initialAdvertisers: Advertiser[]; initialMetaPages: MetaPage[] }) {
  const nextKey = useRef(0);
  const [advertisers, setAdvertisers] = useState(initialAdvertisers);
  const [metaPages, setMetaPages] = useState(initialMetaPages);
  const [searchQuery, setSearchQuery] = useState(brandName);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const newKey = (prefix: string) => `${prefix}-new-${nextKey.current++}`;

  const search = async () => {
    if (!searchQuery.trim()) { setMessage("Enter a brand or advertiser name first."); return; }
    setLoading(true); setMessage("");
    const response = await fetch("/api/google/advertisers/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchQuery }) });
    const payload = await response.json() as { advertisers?: SearchResult[]; error?: string };
    setLoading(false);
    if (!response.ok) { setMessage(payload.error ?? "Advertiser search failed."); return; }
    setSearchResults(payload.advertisers ?? []);
    setMessage(payload.advertisers?.length ? "Add any matching advertiser accounts." : "No advertisers found.");
  };

  const testGoogle = async () => {
    setLoading(true);
    const response = await fetch("/api/google/test-connection", { method: "POST" });
    const payload = await response.json() as { ok?: boolean; error?: string };
    setLoading(false);
    setMessage(payload.ok ? "Google BigQuery connection successful." : payload.error ?? "Google connection failed.");
  };

  const addSearchResult = (item: SearchResult) => {
    if (advertisers.some(advertiser => advertiser.advertiserId === item.advertiserId)) {
      setMessage(`${item.advertiserId} is already configured.`);
      return;
    }
    setAdvertisers(items => [...items, { id: newKey("google"), advertiserId: item.advertiserId, label: item.disclosedName || item.legalName }]);
    setMessage(`Added ${item.advertiserId}.`);
  };

  return <>
    <section className="md:col-span-2">
      <span className="label">Known Google Advertiser IDs</span>
      <div className="grid gap-2">
        {advertisers.map((item, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={item.id}>
          <input aria-label={`Google advertiser ID ${index + 1}`} name="googleAdvertiserIds" value={item.advertiserId} onChange={event => setAdvertisers(items => items.map((current, currentIndex) => currentIndex === index ? { ...current, advertiserId: event.target.value } : current))} placeholder="Advertiser ID" />
          <input aria-label={`Google advertiser label ${index + 1}`} name="googleAdvertiserLabels" value={item.label ?? ""} onChange={event => setAdvertisers(items => items.map((current, currentIndex) => currentIndex === index ? { ...current, label: event.target.value } : current))} placeholder="Label (optional)" />
          <button type="button" className="button button-secondary" onClick={() => setAdvertisers(items => items.filter((_, currentIndex) => currentIndex !== index))}>Remove advertiser ID</button>
        </div>)}
      </div>
      <button type="button" className="button button-secondary mt-2" onClick={() => setAdvertisers(items => [...items, { id: newKey("google"), advertiserId: "", label: null }])}>Add advertiser ID</button>
      <div className="mt-4 flex flex-wrap gap-2">
        <input className="min-w-56 flex-1" aria-label="Search Google advertisers" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search Google advertisers" />
        <button type="button" className="button button-secondary" disabled={loading} onClick={search}>Find advertisers</button>
        <button type="button" className="button button-secondary" disabled={loading} onClick={testGoogle}>Test Google Connection</button>
      </div>
      {message && <p className="mt-2 text-xs text-slate-600">{message}</p>}
      {searchResults.length > 0 && <div className="mt-3 max-h-64 overflow-auto rounded-lg border border-slate-200">{searchResults.map(item => <button type="button" key={item.advertiserId} onClick={() => addSearchResult(item)} className="block w-full border-b border-slate-100 p-3 text-left text-sm last:border-0 hover:bg-teal-50"><span className="block font-semibold">{item.disclosedName || "No disclosed name"}</span><span className="block text-xs text-slate-500">ID: {item.advertiserId}{item.legalName ? ` · ${item.legalName}` : ""}{item.location ? ` · ${item.location}` : ""}</span></button>)}</div>}
    </section>

    <section className="md:col-span-2">
      <span className="label">Meta Page IDs</span>
      <div className="grid gap-2">
        {metaPages.map((item, index) => <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" key={item.id}>
          <input aria-label={`Meta Page ID ${index + 1}`} name="metaPageIds" value={item.pageId} onChange={event => setMetaPages(items => items.map((current, currentIndex) => currentIndex === index ? { ...current, pageId: event.target.value } : current))} placeholder="Page ID" />
          <input aria-label={`Meta page name ${index + 1}`} name="metaPageNames" value={item.pageName ?? ""} onChange={event => setMetaPages(items => items.map((current, currentIndex) => currentIndex === index ? { ...current, pageName: event.target.value } : current))} placeholder="Page name (optional)" />
          <button type="button" className="button button-secondary" onClick={() => setMetaPages(items => items.filter((_, currentIndex) => currentIndex !== index))}>Remove Page ID</button>
        </div>)}
      </div>
      <button type="button" className="button button-secondary mt-2" onClick={() => setMetaPages(items => [...items, { id: newKey("meta"), pageId: "", pageName: null }])}>Add Page ID</button>
    </section>
  </>;
}
