import type { ApifyProvider, CollectionRequest, NormalizedAd } from "@/lib/ad-providers/types";
import { DEFAULT_GOOGLE_ACTOR_ID } from "@/lib/ad-providers/apify";
import { firstText, parsedDate, text, textArray, uniqueUrls } from "@/lib/ad-providers/normalize";
import { env } from "@/lib/env";

export function normalizeGoogleApifyAd(item: Record<string, unknown>): NormalizedAd | null {
  const externalId = text(item.creative_id ?? item.creativeId);
  if (!externalId) return null;
  const descriptions = textArray(item.descriptions);
  const ocr = text(item.ad_ocr_text);
  const bodyText = firstText(item.body_text, item.bodyText, descriptions);
  return {
    source: "GOOGLE",
    externalId,
    advertiserId: text(item.advertiser_id ?? item.advertiserId),
    advertiserName: text(item.advertiser_name ?? item.advertiserName),
    headline: firstText(item.headline, item.headlines),
    bodyText: ocr && ocr !== bodyText ? [bodyText, ocr].filter(Boolean).join("\n") : bodyText,
    description: descriptions.length ? descriptions.join("\n") : undefined,
    cta: firstText(item.cta),
    landingPageUrl: firstText(item.destination_url, item.landingPageUrl),
    sourceUrl: firstText(item.ad_url, item.adUrl),
    startDate: parsedDate(item.first_shown ?? item.firstShown),
    endDate: parsedDate(item.last_shown ?? item.lastShown),
    imageUrls: uniqueUrls(item.image_url, item.imageUrl),
    videoUrls: uniqueUrls(item.video_url, item.videoUrl),
    videoThumbnailUrls: uniqueUrls(item.video_thumbnail_url, item.videoThumbnailUrl),
    platform: firstText(item.ad_surface, item.adSurface),
    format: firstText(item.ad_format, item.adFormat),
    rawData: item,
  };
}

export function googleApifyProvider(request: CollectionRequest): ApifyProvider {
  if (!request.googleDomain) throw new Error("Google Domain not configured.");
  return {
    source: "GOOGLE",
    actorId: env.APIFY_GOOGLE_ACTOR_ID || DEFAULT_GOOGLE_ACTOR_ID,
    input: {
      domains: [request.googleDomain],
      region: request.countryCode.toUpperCase(),
      resultType: "ads",
      startDate: request.startDate,
      endDate: request.endDate,
      maxAds: request.maxResults ?? 500,
      includeAdCopy: true,
      ocrImageAds: true,
    },
    normalize: normalizeGoogleApifyAd,
  };
}
