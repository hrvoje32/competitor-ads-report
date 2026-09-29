# Set up Google BigQuery and Meta, with Apify available as a fallback

You can choose **Google BigQuery / Apify** and **Meta Ad Library API / Apify** independently on each report. Existing reports default to their last collection providers; new reports default to Apify until you change the selectors. Selecting a provider does not start collection. Click **Run Automated Analysis** or **Regenerate Brand** to start it.

Official API failures do not automatically start paid Apify runs. Keep your existing `APIFY_TOKEN` and actor settings so you can switch back. No database migration is required for this change.

## 1. Start with a small test report

1. Keep your existing report as a reference.
2. Create a report containing one brand, country **HR**, and a recent period when you know that brand ran ads.
3. In **Brands → edit the brand**, check its Meta Page IDs and Google Advertiser IDs. Google BigQuery needs advertiser IDs; a website domain alone is insufficient. Keep the Google Domain for Apify.
4. Complete the account setup below before running collection. You can set up either service first.

## 2. Meta account setup

1. Sign in to Facebook and open the [Ad Library API onboarding page](https://www.facebook.com/ads/library/api/).
2. Complete its identity/location verification. Meta says this can take a few days.
3. Register at [Meta for Developers](https://developers.facebook.com/), then return to **Access the API** and create an app using the Ad Library onboarding.
4. Obtain a user access token authorized for Ad Library queries, following the app's onboarding and permissions prompts. A generic app token alone does not establish Ad Library access.
5. Record a supported Graph API version from the Meta dashboard. The repository's `v23.0` example is not a promise that it is the newest version.

These are Meta's [official onboarding instructions and coverage rules](https://br-fr.facebook.com/ads/library/api/?source=archive-landing-page). Commercial coverage includes ads delivered to the EU/UK during the past year; an empty response does not prove the advertiser ran no ads elsewhere.

## 3. Connect Meta to this app

1. In Vercel, open this project → **Settings → Environment Variables**. Add the following for the environment you will test:

   ```dotenv
   META_ACCESS_TOKEN=YOUR_AUTHORIZED_USER_TOKEN
   META_GRAPH_API_VERSION=YOUR_SUPPORTED_VERSION
   ```

2. Redeploy to load the new settings. For local development, put them in `.env.local` and restart the development server. Keep the token server-side; do not add a `NEXT_PUBLIC_` prefix or commit it.
3. Save the competitor's numeric Facebook Page ID in the brand editor. This is a Page ID, not an individual ad's Library ID.
4. Open the test report → **Review Brand Report → SOCIAL MEDIA ADS → Meta Ad Library API tools → Test Meta connection**.
5. To check records first, click **Import from Meta API**. This imports metadata without launching the full report automation or Apify.
6. Once that works, return to the report, select **Meta Ad Library API** for Meta, and use automation. The Google selector remains independent: if it says Apify, running automation will use Apify for Google.

The app does not renew Meta tokens. Replace the configured token when it expires or is revoked and redeploy/restart.

## 4. Create the Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project for this app.
2. Record its **Project ID** and numeric **Project number** from the project settings.
3. Enable **BigQuery API**, plus **IAM**, **Cloud Resource Manager**, **IAM Service Account Credentials**, and **Security Token Service** APIs for federation if they are not enabled. See [Google's federation setup](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers).
4. Create a service account, for example `competitor-ads-reader`.
5. Grant that account **BigQuery Job User** (`roles/bigquery.jobUser`) on this project. The app needs to execute queries; it does not need BigQuery Admin. Dataset access comes from the public advertising dataset. See [BigQuery permissions](https://docs.cloud.google.com/bigquery/docs/access-control).
6. Open the [Google Ads Transparency public dataset](https://console.cloud.google.com/marketplace/product/bigquery-public-data/google-ads-transparency-center). The app queries `bigquery-public-data.google_ads_transparency_center.creative_stats`; you do not need to copy it into your project.

Google's public transparency access has geographic coverage limits. Check the intended country, particularly outside the EEA, against [Google's transparency documentation](https://support.google.com/adspolicy/answer/13733850?hl=en).

## 5. Allow Vercel to authenticate to Google

The app uses Vercel OIDC, not a downloaded service-account JSON key.

1. In Google **IAM & Admin → Workload Identity Federation**, create a pool and OIDC provider, for example both named `vercel`.
2. Match the issuer to your Vercel issuer mode: `https://oidc.vercel.com/YOUR_TEAM_SLUG` for team mode, or `https://oidc.vercel.com` for global mode.
3. Choose **Allowed audiences** and enter `https://vercel.com/YOUR_TEAM_SLUG`. This matches the current app; selecting the default Google audience requires different token configuration.
4. Map `google.subject` to `assertion.sub`.

Follow the corresponding screens in [Vercel's Google connection guide](https://vercel.com/docs/oidc/gcp).

On your service account, grant **Workload Identity User** (`roles/iam.workloadIdentityUser`) to the exact federated principal for this project/environment:

```text
principal://iam.googleapis.com/projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/POOL_ID/subject/owner:TEAM_SLUG:project:VERCEL_PROJECT_NAME:environment:production
```

Use your actual values. Add separate principals for `preview` or `development` only if you will use those environments. This grants permission to impersonate the account; the account's BigQuery Job User role determines what it can query. See [Google's service-account impersonation instructions](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers).

## 6. Add Google's environment values

Add these to your Vercel project's environment variables and redeploy:

```dotenv
GCP_PROJECT_ID=YOUR_PROJECT_ID
GCP_PROJECT_NUMBER=YOUR_NUMERIC_PROJECT_NUMBER
GCP_SERVICE_ACCOUNT_EMAIL=competitor-ads-reader@YOUR_PROJECT_ID.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel
BIGQUERY_MAX_BYTES_BILLED=10737418240
```

The two pool/provider values must match what you created. The app reads these settings in `lib/integrations/google/auth.ts` and `lib/env.ts`.

For local development, link the Vercel project and pull development settings:

```sh
vercel link
vercel env pull
```

This also supplies the short-lived `VERCEL_OIDC_TOKEN`. Refresh it when it expires and restart the app. Ensure your federation permits the development identity. See [Vercel's local OIDC instructions](https://vercel.com/docs/oidc). Review/retain existing local settings when pulling environment files.

## 7. Test Google before automating

1. In the app's brand editor, click **Test Google Connection**. This checks authentication and query execution with `SELECT 1`; it does not verify advertising coverage.
2. Enter a known Google Advertiser ID, or click **Find advertisers**, select the correct account, and save the brand.
3. Open the test report → **Review Brand Report → GOOGLE ADS → Google BigQuery tools → Import from BigQuery**. This checks access to the actual dataset and report-period records without an Apify run.
4. Confirm the returned advertiser, dates, and country before relying on the results.
5. Back on the report page, choose **Google BigQuery** and **Meta Ad Library API**, then **Run Automated Analysis**.

## 8. Cost and image behavior

BigQuery's free on-demand allowance is [1 TiB processed per month](https://cloud.google.com/bigquery/pricing). A query returning ten ads can still scan much more data. Account/billing requirements depend on your Google setup; this integration does not guarantee zero billing.

The app now rejects queries estimated to bill over **10 GiB per query** by default using `BIGQUERY_MAX_BYTES_BILLED`. This applies to advertiser search and imports. It is not a monthly budget. Large public-dataset queries may hit this limit even for one brand. Check the estimate in BigQuery before increasing it. See [Google's cost controls](https://docs.cloud.google.com/bigquery/docs/best-practices-costs). You can also configure project query quotas; [custom quotas are approximate](https://docs.cloud.google.com/bigquery/docs/custom-quotas).

Official collection stores ad metadata and creative links. It attempts one screenshot per source per status check, stops at the existing eight stored images per source, and stops trying further ads after twelve capture failures. It requires an identifiable creative element; an unrecognized page is not automatically accepted as ad evidence.

Local capture needs Playwright Chromium installed (`npx playwright install chromium`). On Vercel, the existing browser integration needs `BROWSER_WS_ENDPOINT`. That browser service may have its own fees. If capture is unavailable or blocked, the records remain available: open an ad, upload its screenshot, select evidence, and generate analysis from the brand workspace. AI analysis and hosting/storage costs remain separate.

## 9. Switch back to Apify

1. Wait until the current run finishes.
2. On the report page, set either or both source selectors to **Apify**.
3. Click **Run Automated Analysis**. For one brand, expand **Change collection sources**, choose Apify, then click **Regenerate Brand**.
4. Keep the Google Domain, Meta Page IDs, `APIFY_TOKEN`, and actor settings configured.

There is no redeploy or code rollback needed to change providers. Matching ad IDs are merged; screenshots, crops, and notes are retained, including ads only one provider returned. Collected counts describe the latest response; the review workspace may also contain earlier retained ads. A failed or empty response does not erase them. Existing media cleanup remains an explicit action in the report controls.

**Retry Failed** recollects sources whose collection failed. If collection succeeded but images were missing, use **Regenerate Brand** after changing provider, or add screenshots manually. Changing provider selections alone does not affect a run already in progress.

## Common problems

| Symptom | Next step |
| --- | --- |
| Meta permission error | Complete Ad Library onboarding for the token's user/app. |
| Meta expired token | Obtain a valid replacement, update environment settings, redeploy/restart. |
| Google OIDC/audience error | Check issuer mode, team slug, allowed audience, and environment principal. |
| Google `iam.serviceAccounts.getAccessToken` denied | Check Workload Identity User permission on the service account. |
| Google `bigquery.jobs.create` denied | Check BigQuery Job User permission in the execution project. |
| Google query exceeds byte limit | Inspect its estimated scan cost before raising the configured cap. |
| Connection test passes but no ads appear | Check advertiser/Page IDs, country, date range, and source coverage. |
| Ads imported but no analysis | Upload/select usable screenshots, or regenerate with Apify. |

The automated checks for this change use mocked upstream services. Account authorization, live dataset access, and screenshot success must be verified through the test report after setup.
