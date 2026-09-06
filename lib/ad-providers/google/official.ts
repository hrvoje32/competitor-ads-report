import type { NormalizedAd } from "@/lib/ad-providers/types";
import { fetchCreatives } from "@/lib/google-ads-transparency";

/** Optional legacy adapter. The automated workflow uses the Apify provider. */
export async function collectGoogleOfficial(advertiserIds: string[], countryCode: string, startDate: string, endDate: string): Promise<NormalizedAd[]> {
  return (await fetchCreatives(advertiserIds, countryCode, startDate, endDate)).map(item => ({
    source: "GOOGLE", externalId: item.creativeId, advertiserId: item.advertiserId,
    advertiserName: item.disclosedName ?? undefined, headline: item.topic ?? undefined,
    sourceUrl: item.creativePageUrl ?? undefined, startDate: item.firstShown ?? undefined,
    endDate: item.lastShown ?? undefined, imageUrls: [], videoUrls: [], videoThumbnailUrls: [],
    platform: "Google Ads", format: item.format ?? undefined,
  }));
}
