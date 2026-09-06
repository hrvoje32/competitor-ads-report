import type { NormalizedAd } from "@/lib/ad-providers/types";
import { fetchMetaAds } from "@/lib/meta-ad-library";

/** Optional legacy adapter. The automated workflow uses the Apify provider. */
export async function collectMetaOfficial(pageIds: string[], countryCode: string, startDate: string, endDate: string): Promise<NormalizedAd[]> {
  return (await fetchMetaAds(pageIds, countryCode, startDate, endDate)).map(item => ({
    source: "META", externalId: item.id, advertiserId: item.pageId ?? undefined,
    advertiserName: item.pageName ?? undefined, headline: item.headline ?? undefined,
    bodyText: item.body ?? undefined, sourceUrl: item.snapshotUrl ?? undefined,
    startDate: item.firstShown ?? undefined, endDate: item.lastShown ?? undefined,
    imageUrls: [], videoUrls: [], videoThumbnailUrls: [], platform: item.platform ?? undefined,
  }));
}
