export type AdProviderSource = "GOOGLE" | "META";

export type NormalizedAd = {
  source: AdProviderSource;
  externalId: string;
  advertiserId?: string;
  advertiserName?: string;
  headline?: string;
  bodyText?: string;
  description?: string;
  cta?: string;
  landingPageUrl?: string;
  sourceUrl?: string;
  startDate?: Date;
  endDate?: Date;
  imageUrls: string[];
  videoUrls: string[];
  videoThumbnailUrls: string[];
  platform?: string;
  format?: string;
  rawData?: Record<string, unknown>;
};

export type CollectionRequest = {
  brandName: string;
  googleDomain?: string | null;
  metaPageIds: string[];
  countryCode: string;
  startDate: string;
  endDate: string;
  maxResults?: number;
};

export type ApifyProvider = {
  source: AdProviderSource;
  actorId: string;
  input: Record<string, unknown>;
  normalize: (item: Record<string, unknown>) => NormalizedAd | null;
};
