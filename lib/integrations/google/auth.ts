import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";
import { env, requireServerEnv } from "@/lib/env";

export function googleAuthClient() {
  requireServerEnv("GCP_PROJECT_ID", "GCP_PROJECT_NUMBER", "GCP_SERVICE_ACCOUNT_EMAIL", "GCP_WORKLOAD_IDENTITY_POOL_ID", "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID");
  const client = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience: "//iam.googleapis.com/projects/" + env.GCP_PROJECT_NUMBER + "/locations/global/workloadIdentityPools/" + env.GCP_WORKLOAD_IDENTITY_POOL_ID + "/providers/" + env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + env.GCP_SERVICE_ACCOUNT_EMAIL + ":generateAccessToken",
    subject_token_supplier: { getSubjectToken: getVercelOidcToken },
  });
  if (!client) throw new Error("Google integration is unavailable: unable to create the federation client.");
  return client;
}
