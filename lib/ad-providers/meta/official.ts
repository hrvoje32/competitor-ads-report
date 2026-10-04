import type { NormalizedAd } from "@/lib/ad-providers/types";
import { fetchMetaAds } from "@/lib/meta-ad-library";

export async function collectMetaOfficial(pageIds: string[], countryCode: string, startDate: string, endDate: string): Promise<NormalizedAd[]> {
  if (!pageIds.length) throw new Error("Add Meta Page IDs in the brand settings before using the Meta Ad Library API.");
  return (await fetchMetaAds(pageIds, countryCode, startDate, endDate)).map(item => ({
    source: "META", externalId: item.id, advertiserId: item.pageId ?? undefined,
    advertiserName: item.pageName ?? undefined, headline: item.headline ?? undefined,
    bodyText: item.body ?? undefined, sourceUrl: item.snapshotUrl ?? undefined,
    startDate: item.firstShown ?? undefined, endDate: item.lastShown ?? undefined,
    imageUrls: [], videoUrls: [], videoThumbnailUrls: [], platform: item.platform ?? undefined,
    reachLower: item.reachLower ?? undefined, reachUpper: item.reachUpper ?? undefined,
    rawData: { page_id: item.pageId, page_name: item.pageName },
  }));
}
