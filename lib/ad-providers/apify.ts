import { ApifyClient } from "apify-client";
import { env } from "@/lib/env";

export const DEFAULT_META_ACTOR_ID = "webdata_labs/meta-ads-library-scraper";
export const DEFAULT_GOOGLE_ACTOR_ID = "hyperbach/google-ads-transparency-scraper";

export function apifyClient() {
  if (!env.APIFY_TOKEN) throw new Error("Apify is not configured. Set APIFY_TOKEN.");
  return new ApifyClient({ token: env.APIFY_TOKEN });
}

export function apifyError(error: unknown) {
  const fallback = "Apify request failed.";
  if (!(error instanceof Error)) return fallback;
  const token = env.APIFY_TOKEN;
  return token ? error.message.split(token).join("[redacted]") : error.message;
}

export async function startApifyActor(actorId: string, input: Record<string, unknown>) {
  const run = await apifyClient().actor(actorId).start(input);
  return { runId: run.id, datasetId: run.defaultDatasetId, status: run.status };
}

export async function getApifyRun(runId: string) {
  const run = await apifyClient().run(runId).get();
  if (!run) throw new Error("Apify run was not found.");
  return { runId: run.id, datasetId: run.defaultDatasetId, status: run.status };
}

export async function getApifyDatasetItems(datasetId: string) {
  const { items } = await apifyClient().dataset(datasetId).listItems({ clean: true, limit: 10_000 });
  return items as Record<string, unknown>[];
}
