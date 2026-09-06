import { z } from "zod";

const optional = z.string().trim().min(1).optional();
const serverSchema = z.object({
  DATABASE_URL: optional, DIRECT_URL: optional, SUPABASE_URL: optional, SUPABASE_SECRET_KEY: optional,
  OPENAI_API_KEY: optional, OPENAI_MODEL: z.string().trim().default("gpt-5.4-mini"), BROWSER_WS_ENDPOINT: optional,
  APIFY_TOKEN: optional, APIFY_META_ACTOR_ID: optional, APIFY_GOOGLE_ACTOR_ID: optional,
  META_ACCESS_TOKEN: optional, META_GRAPH_API_VERSION: optional, GCP_PROJECT_ID: optional,
  GCP_PROJECT_NUMBER: optional, GCP_SERVICE_ACCOUNT_EMAIL: optional, GCP_WORKLOAD_IDENTITY_POOL_ID: optional,
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: optional,
});
export const env = serverSchema.parse(process.env);
export function openAIModel() {
  const configured = process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini";
  return configured === "5.4-mini" ? "gpt-5.4-mini" : configured;
}
export function requireServerEnv(...names: Array<keyof typeof env>) {
  const missing = names.filter(name => !env[name]);
  if (missing.length) throw new Error("Configuration required: " + missing.join(", ") + ".");
}
export function hasSupabaseStorageConfig() { return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY); }
