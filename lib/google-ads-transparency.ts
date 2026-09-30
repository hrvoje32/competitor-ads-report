import { BigQuery, type Query } from "@google-cloud/bigquery";
import { env } from "@/lib/env";
import { googleAuthClient } from "@/lib/integrations/google/auth";

const TABLE = "`bigquery-public-data.google_ads_transparency_center.creative_stats`";
export type GoogleAdvertiser = { advertiserId: string; disclosedName: string | null; legalName: string | null; location: string | null };
export type GoogleCreative = GoogleAdvertiser & { creativeId: string; creativePageUrl: string | null; format: string | null; topic: string | null; fundedBy: string | null; regionCode: string; firstShown: Date | null; lastShown: Date | null; reachLower: number | null; reachUpper: number | null };

function client() { if (!env.GCP_PROJECT_ID) throw new Error("Google integration is unavailable: configure Vercel OIDC and Google Workload Identity Federation."); return new BigQuery({ projectId: env.GCP_PROJECT_ID, authClient: googleAuthClient() }); }
export function bigQueryOptions(options: Query): Query {
  return { ...options, useLegacySql: false, maximumBytesBilled: env.BIGQUERY_MAX_BYTES_BILLED };
}

async function queryRows(options: Query) {
  try {
    const [rows] = await client().query(bigQueryOptions(options));
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google BigQuery query failed.";
    if (/maximum.*bytes|bytes.*billed|billingTierLimitExceeded/i.test(message)) {
      throw new Error("Google BigQuery query exceeded BIGQUERY_MAX_BYTES_BILLED. Review its estimated cost before raising the limit, or choose another collection source.");
    }
    throw error;
  }
}

export function googleDate(value: unknown): Date | null {
  const raw = value && typeof value === "object" && "value" in value ? value.value : value;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function testGoogleConnection() { const rows = await queryRows({ query: "SELECT 1 AS ok", useLegacySql: false }); return rows[0]?.ok === 1; }
export async function findAdvertisers(query: string): Promise<GoogleAdvertiser[]> { const rows = await queryRows({ query: `SELECT CAST(advertiser_id AS STRING) AS advertiser_id, ANY_VALUE(advertiser_disclosed_name) AS advertiser_disclosed_name, ANY_VALUE(advertiser_legal_name) AS advertiser_legal_name, ANY_VALUE(advertiser_location) AS advertiser_location FROM ${TABLE} WHERE LOWER(advertiser_disclosed_name) LIKE CONCAT('%', LOWER(@query), '%') OR LOWER(advertiser_legal_name) LIKE CONCAT('%', LOWER(@query), '%') GROUP BY advertiser_id LIMIT @limit`, params: { query, limit: 25 }, types: { query: "STRING", limit: "INT64" }, useLegacySql: false }); return rows.map((row: Record<string, unknown>) => ({ advertiserId: String(row.advertiser_id), disclosedName: row.advertiser_disclosed_name ? String(row.advertiser_disclosed_name) : null, legalName: row.advertiser_legal_name ? String(row.advertiser_legal_name) : null, location: row.advertiser_location ? String(row.advertiser_location) : null })); }
export async function discoverAdvertisers(query: string, countryCode: string, startDate: string, endDate: string): Promise<GoogleAdvertiser[]> {
  const rows = await queryRows({
    query: `SELECT CAST(advertiser_id AS STRING) AS advertiser_id, ANY_VALUE(advertiser_disclosed_name) AS advertiser_disclosed_name, ANY_VALUE(advertiser_legal_name) AS advertiser_legal_name, ANY_VALUE(advertiser_location) AS advertiser_location FROM ${TABLE}, UNNEST(region_stats) AS region WHERE region.region_code = @countryCode AND DATE(region.first_shown) <= DATE(@endDate) AND DATE(region.last_shown) >= DATE(@startDate) AND (LOWER(advertiser_disclosed_name) LIKE CONCAT('%', LOWER(@query), '%') OR LOWER(advertiser_legal_name) LIKE CONCAT('%', LOWER(@query), '%')) GROUP BY advertiser_id LIMIT @limit`,
    params: { query, countryCode: countryCode.toUpperCase(), startDate, endDate, limit: 25 },
    types: { query: "STRING", countryCode: "STRING", startDate: "STRING", endDate: "STRING", limit: "INT64" },
    useLegacySql: false,
  });
  return rows.map((row: Record<string, unknown>) => ({
    advertiserId: String(row.advertiser_id),
    disclosedName: row.advertiser_disclosed_name ? String(row.advertiser_disclosed_name) : null,
    legalName: row.advertiser_legal_name ? String(row.advertiser_legal_name) : null,
    location: row.advertiser_location ? String(row.advertiser_location) : null,
  }));
}
function creativesQuery(advertiserIds: string[], countryCode: string, startDate: string, endDate: string) {
  return {
    query: `SELECT CAST(advertiser_id AS STRING) AS advertiser_id, advertiser_disclosed_name, advertiser_legal_name, creative_id, creative_page_url, ad_format_type, advertiser_location, topic, ad_funded_by, region.region_code, region.first_shown, region.last_shown, region.times_shown_lower_bound, region.times_shown_upper_bound FROM ${TABLE}, UNNEST(region_stats) AS region WHERE CAST(advertiser_id AS STRING) IN UNNEST(@advertiserIds) AND region.region_code = @countryCode AND DATE(region.first_shown) <= DATE(@endDate) AND DATE(region.last_shown) >= DATE(@startDate)`,
    params: { advertiserIds, countryCode: countryCode.toUpperCase(), startDate, endDate },
    types: { advertiserIds: ["STRING"], countryCode: "STRING", startDate: "STRING", endDate: "STRING" },
    useLegacySql: false,
  } satisfies Query;
}

export type GoogleQueryEstimate = {
  totalBytesProcessed: string;
  estimatedGiB: number;
  maximumBytesBilled: string;
  limitGiB: number;
  exceedsLimit: boolean;
  advertiserIds: string[];
  countryCode: string;
  startDate: string;
  endDate: string;
};

export async function estimateCreativesQuery(advertiserIds: string[], countryCode: string, startDate: string, endDate: string): Promise<GoogleQueryEstimate> {
  if (!advertiserIds.length) throw new Error("Advertiser IDs not configured");
  const query = creativesQuery(advertiserIds, countryCode, startDate, endDate);
  // Dry runs never execute the query. Omit the execution billing cap so an
  // over-limit estimate can be returned; collection still uses bigQueryOptions.
  const [job] = await client().createQueryJob({ ...query, dryRun: true, useQueryCache: false });
  const totalBytesProcessed: unknown = job.metadata?.statistics?.totalBytesProcessed;
  if (typeof totalBytesProcessed !== "string" || !/^\d+$/.test(totalBytesProcessed)) {
    throw new Error("BigQuery did not return a valid scan estimate.");
  }
  const maximumBytesBilled = env.BIGQUERY_MAX_BYTES_BILLED;
  return {
    totalBytesProcessed,
    estimatedGiB: Number(totalBytesProcessed) / 2 ** 30,
    maximumBytesBilled,
    limitGiB: Number(maximumBytesBilled) / 2 ** 30,
    // Keep exact byte counts and comparisons even beyond Number.MAX_SAFE_INTEGER.
    exceedsLimit: BigInt(totalBytesProcessed) > BigInt(maximumBytesBilled),
    ...query.params,
  };
}

export async function fetchCreatives(advertiserIds: string[], countryCode: string, startDate: string, endDate: string): Promise<GoogleCreative[]> {
  if (!advertiserIds.length) return [];
  const rows = await queryRows(creativesQuery(advertiserIds, countryCode, startDate, endDate));
  return rows.map((row: Record<string, unknown>) => ({ advertiserId: String(row.advertiser_id), disclosedName: row.advertiser_disclosed_name ? String(row.advertiser_disclosed_name) : null, legalName: row.advertiser_legal_name ? String(row.advertiser_legal_name) : null, location: row.advertiser_location ? String(row.advertiser_location) : null, creativeId: String(row.creative_id), creativePageUrl: row.creative_page_url ? String(row.creative_page_url) : null, format: row.ad_format_type ? String(row.ad_format_type) : null, topic: row.topic ? String(row.topic) : null, fundedBy: row.ad_funded_by ? String(row.ad_funded_by) : null, regionCode: String(row.region_code), firstShown: googleDate(row.first_shown), lastShown: googleDate(row.last_shown), reachLower: row.times_shown_lower_bound === null || row.times_shown_lower_bound === undefined ? null : Number(row.times_shown_lower_bound), reachUpper: row.times_shown_upper_bound === null || row.times_shown_upper_bound === undefined ? null : Number(row.times_shown_upper_bound) }));
}
