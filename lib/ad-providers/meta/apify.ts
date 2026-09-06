import type { ApifyProvider, CollectionRequest, NormalizedAd } from "@/lib/ad-providers/types";
import { DEFAULT_META_ACTOR_ID } from "@/lib/ad-providers/apify";
import { firstText, nestedRecords, parsedDate, text, textArray, uniqueUrls } from "@/lib/ad-providers/normalize";
import { env } from "@/lib/env";

function cardMedia(cards: unknown) {
  const records = nestedRecords(cards);
  return {
    images: uniqueUrls(...records.flatMap(card => [card.imageUrl, card.image_url, card.image, card.originalImageUrl])),
    videos: uniqueUrls(...records.flatMap(card => [card.videoUrl, card.video_url])),
    thumbnails: uniqueUrls(...records.flatMap(card => [card.videoThumbnailUrl, card.video_thumbnail_url, card.thumbnailUrl])),
  };
}

export function normalizeMetaApifyAd(item: Record<string, unknown>): NormalizedAd | null {
  if (item.resultType && item.resultType !== "ad") return null;
  const externalId = text(item.libraryId ?? item.library_id ?? item.id);
  if (!externalId) return null;
  const cardUrls = cardMedia(item.cards);
  return {
    source: "META",
    externalId,
    advertiserId: text(item.pageId ?? item.page_id),
    advertiserName: text(item.pageName ?? item.page_name),
    headline: firstText(item.headline, item.title),
    bodyText: firstText(item.bodyText, item.body_text, item.primaryText),
    description: firstText(item.description, item.linkDescription),
    cta: firstText(item.ctaText, item.cta_text, item.cta),
    landingPageUrl: firstText(item.landingPageUrl, item.landing_page_url),
    sourceUrl: firstText(item.adUrl, item.ad_url, item.sourceUrl),
    startDate: parsedDate(item.startDate ?? item.start_date),
    endDate: parsedDate(item.endDate ?? item.end_date),
    imageUrls: uniqueUrls(item.imageUrls, item.image_urls, item.imageUrl, cardUrls.images),
    videoUrls: uniqueUrls(item.videoUrls, item.video_urls, item.videoUrl, cardUrls.videos),
    videoThumbnailUrls: uniqueUrls(item.videoThumbnailUrls, item.video_thumbnail_urls, item.videoThumbnailUrl, cardUrls.thumbnails),
    platform: textArray(item.publisherPlatforms ?? item.publisher_platforms).join(", ") || undefined,
    format: firstText(item.creativeType, item.creative_type),
    rawData: item,
  };
}

export function metaApifyProvider(request: CollectionRequest): ApifyProvider {
  if (!request.metaPageIds.length) throw new Error("Meta Page ID missing.");
  return {
    source: "META",
    actorId: env.APIFY_META_ACTOR_ID || DEFAULT_META_ACTOR_ID,
    input: {
      pageIds: request.metaPageIds,
      countryCode: request.countryCode.toUpperCase(),
      activeStatus: "all",
      category: "all",
      mediaType: "all",
      sortBy: "recent",
      dateFrom: request.startDate,
      dateTo: request.endDate,
      maxResults: request.maxResults ?? 500,
      isDetailsPerAd: true,
      includeAboutPage: false,
    },
    normalize: normalizeMetaApifyAd,
  };
}
