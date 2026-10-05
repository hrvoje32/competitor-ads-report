import { adMetadata, hasUsableScreenshot } from "@/lib/brand-ad-filter";
import { rankCaptureCandidates, type CaptureCandidate } from "@/lib/official-capture-policy";
import { MAX_APIFY_CANDIDATES_PER_SOURCE } from "@/lib/ad-evidence-limits";

export function apifyCandidatePool<T extends CaptureCandidate>(items: T[], datasetId?: string | null) {
  // Retained images remain reusable, but old provider metadata cannot expand a
  // new dataset's download budget. Legacy reports without provenance still load.
  const collected = items.filter(item => !datasetId || adMetadata(item).apifyDatasetId === datasetId
    || (!adMetadata(item).apifyDatasetId && adMetadata(item).collectionProvider !== "OFFICIAL"));
  // Fix the pool independently of download outcomes. Otherwise each newly
  // stored image could change diversity ranking and admit another legacy row.
  const pool = collected.sort((a, b) => ((b.lastShown || b.firstShown)?.getTime() || 0)
    - ((a.lastShown || a.firstShown)?.getTime() || 0) || a.id.localeCompare(b.id))
    .slice(0, MAX_APIFY_CANDIDATES_PER_SOURCE);
  const ids = new Set(pool.map(item => item.id));
  return items.filter(item => ids.has(item.id) || hasUsableScreenshot(item));
}
export function rankedApifyCandidates<T extends CaptureCandidate>(items: T[], datasetId?: string | null) {
  return rankCaptureCandidates(apifyCandidatePool(items, datasetId), true).slice(0, MAX_APIFY_CANDIDATES_PER_SOURCE);
}
