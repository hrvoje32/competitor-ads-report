import type { NormalizedAd } from "@/lib/ad-providers/types";
import { fetchCreatives } from "@/lib/google-ads-transparency";

export async function collectGoogleOfficial(advertiserIds: string[], countryCode: string, startDate: string, endDate: string): Promise<NormalizedAd[]> {
  if (!advertiserIds.length) throw new Error("Add Google Advertiser IDs in the brand settings before using Google BigQuery.");
  return (await fetchCreatives(advertiserIds, countryCode, startDate, endDate)).map(item => ({
    source: "GOOGLE", externalId: item.creativeId, advertiserId: item.advertiserId,
    advertiserName: item.disclosedName ?? undefined,
    sourceUrl: item.creativePageUrl ?? undefined, startDate: item.firstShown ?? undefined,
    endDate: item.lastShown ?? undefined, imageUrls: [], videoUrls: [], videoThumbnailUrls: [],
    platform: "Google Ads", format: item.format ?? undefined,
    reachLower: item.reachLower ?? undefined, reachUpper: item.reachUpper ?? undefined,
    // Google's topic is a classification, not the actual ad headline.
    rawData: { topic: item.topic, fundedBy: item.fundedBy },
  }));
}
