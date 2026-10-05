# Apify production evidence

Google and Meta default to Apify for new reports. Each provider selector remains
independent, and existing reports retain their chosen providers. BigQuery, Meta
Ad Library API and Browserless remain available.

## Actor media contract

The repository defaults are `hyperbach/google-ads-transparency-scraper` and
`webdata_labs/meta-ads-library-scraper`; Vercel's `APIFY_GOOGLE_ACTOR_ID` and
`APIFY_META_ACTOR_ID` may override them. The publisher documentation was checked
on 2026-10-05, without starting a paid run or inspecting production credentials.
These are documented fields, not a claim about a sampled production dataset.

- Google documents `image_url` and `preview_url`. A preview may be HTML, so it
  must pass the same response/content validation as every other image. The
  adapter also accepts image arrays, camelCase aliases, preview image aliases
  and video/thumbnail aliases when provided. Video URLs remain metadata; video
  files and YouTube pages are not downloaded as images.
- Meta documents `imageUrls`, `videoUrls`, `videoThumbnailUrls`, and `cards`.
  Card and nested snapshot image/video-thumbnail aliases are also supported.
  The publisher currently marks this default Meta actor under maintenance;
  actor availability/output still needs production verification.

Publisher references:
- https://apify.com/hyperbach/google-ads-transparency-scraper
- https://apify.com/webdata_labs/meta-ads-library-scraper

## Budgets and storage

`lib/ad-evidence-limits.ts` defines the 20-candidate collection limit, five
creatives per source and three media URLs per creative. Actor inputs and dataset
reads are bounded. Normalize, reject explicit brand conflicts, deduplicate and
rank before downloading. Ranking prefers retained evidence, distinct formats,
messages, campaigns and destinations, then recency. Duplicate IDs, creative
URLs, media URLs and identical/near-identical copy collapse into one candidate.
Identical downloaded image bytes are also rejected before a second storage write.

Each polling request tries one ranked creative, up to three image/thumbnail URLs.
The existing downloader checks public URLs and redirects, rejects non-images,
limits bytes/pixels, normalizes to WebP, and writes to the configured Supabase
`ad-evidence` bucket. A successful write records the permanent storage path and
`APIFY_MEDIA` evidence method. Download or upload failure advances to another
candidate. Processing stops at five stored representatives or pool exhaustion.
The existing transient HTTP retry limit remains three attempts per URL.

Automatic Apify processing has no browser dependency. It no longer manufactures
Google text cards as a substitute for an ad image. Missing assets allow manual
upload or optional browser capture; a browser action cannot bypass pending
direct media processing. Existing synthetic cards and all other historic images
are retained.

A database lease prevents overlapping media processing. Matching completed
Apify datasets are reused on regeneration, including their failure history;
changing the actor or collection inputs starts a new bounded run. Files already
stored are not downloaded again from the actor. New report periods get their
own collection. No collected records or historic files are automatically deleted.

## Brand safety and report output

Brand domain and saved Meta Page IDs remain the primary actor inputs. Apify
evidence is rejected on conflicting known Meta Page IDs, configured excluded
domains, or configured excluded brand names in creative/destination/owner
metadata. Existing `adExcludeKeywords` and `adExcludedDomains` are optional.
For example, Peugeot exclusions can include Citroën, Fiat and Mercedes-Benz.
Missing brand keywords or missing Page metadata alone do not reject Apify ads;
positive keyword/domain allowlists continue to govern official evidence.

The UI shows provider, collected, unique, selected and stored counts per source.
AI and PowerPoint share the same ordered selection of at most five usable
creatives per source. Fewer are accepted. PowerPoint retains the Google, Social
and narrative slides, and reads selected stored images only. Older selections
above five are bounded in memory at export without deleting database records.

No new schema migration is required. Existing Vercel Apify and Supabase settings
remain in use. `.env.local` was not used.

## Actor cost protection

Both integrations start Actors through `startApifyActor` in
`lib/ad-providers/apify.ts`, using `actor(actorId).start(input, options)`.
No Actor calls, tasks or separate REST start paths are used.

Optional Vercel configuration, with safe defaults:

```text
APIFY_MAX_ITEMS_PER_RUN=20
APIFY_MAX_CHARGE_USD_PER_RUN=0.10
```

`lib/ad-providers/apify-cost-policy.ts` validates these values. Missing, zero,
negative or non-numeric settings use the defaults. The item limit may be lowered
but cannot exceed the existing 20-candidate ceiling. The charge setting accepts
a positive finite dollar amount. These settings are read only by Apify code.

Both the Google `maxAds` and Meta `maxResults` INPUT values use that bounded item
limit, including a second check at the shared start boundary. Limiting the dataset
read locally is only an additional guard, not the collection cost protection.
Five representative creatives per source remains unchanged.

Before starting a new run, the helper reads the configured Actor's current pricing
metadata, ignoring future scheduled prices. An isolated read-only Vercel build on
2026-10-05 verified the actual protected production overrides:

| Production source | Current pricing | Paid-item cap | Run charge cap |
| --- | --- | --- | --- |
| Google | `PAY_PER_EVENT` | Not applicable; INPUT `maxAds` limits results | `$0.10` default |
| Meta | `PAY_PER_EVENT` | Not applicable; INPUT `maxResults` limits results | `$0.10` default |

Neither actor reported a higher `minimalMaxTotalChargeUsd`. No paid actor run was
started during verification. Actor IDs remained redacted by Vercel.

Apify documents `maxItems` as a pay-per-result-only charging limit. Accordingly,
the helper supplies it for `PRICE_PER_DATASET_ITEM` actors, not PPE actors. The
current REST documentation supports `maxTotalChargeUsd` across pricing models
(the installed JavaScript client's older comments still describe it as PPE-only):
https://docs.apify.com/api/v2/actors-runs-post

If the API explicitly rejects `maxTotalChargeUsd` as unsupported with HTTP 400/422,
the helper retries once without that option, retaining the actor INPUT limit and
the paid-item cap where applicable. It logs that the dollar cap is unavailable.
It never removes the cap for a minimum-charge validation error, authentication
failure, timeout, or 5xx response. Automatic SDK retries are disabled for paid
start requests to avoid duplicating a potentially accepted run. Metadata reads
retain the client's normal retry behavior; failed metadata checks start no run.

Safe logs show source, sanitized brand name, pricing model, requested result limit,
applicable paid-item limit, actual charge-cap option and fallback protection mode.
They never include the token or complete actor INPUT. For current PPE actors,
`maxPaidItems` is `null`, explicitly avoiding a false claim of a paid-item cap.

## Verification

Run `node --import tsx scripts/apify-media.test.ts` for the direct media,
mocked Supabase, no-browser, budgets, concurrency, reuse, filtering, partial
analysis and actual three-slide PowerPoint export tests. Run
`scripts/provider-switching.test.ts` for independent provider choices and paid
actor reuse. Other official capture/filter/analysis tests remain applicable.
Tests intercept network calls and do not launch paid actors or write to
production storage.

`node --import tsx scripts/apify-cost-protection.test.ts` covers configuration,
both actor INPUT limits, PPE/PPR run options, explicit unsupported-cap fallback,
ambiguous-error handling, effective pricing dates and secret-safe logging.

## Progress recovery and missing images

The report page drives automation through progress GET requests. Keep the page
open; reopening it resumes active work. A single client loop retries temporary
network errors, timeout pages and incomplete JSON, with delays capped at 30 seconds.
Authentication errors stop with a sign-in message. Actor-start POST requests are
never automatically repeated after an ambiguous response. Each progress request
advances at most three brands, ordered by their last update.

After collection finishes, analysis uses the readable images available from either
source. Unreadable selections are removed from analysis/export without deleting
the records or stored files. If none remain, the brand completes with an explicit
"Analysis skipped" warning and the report continues. Source failures remain visible.
PowerPoint exports placeholders for skipped brands rather than previous findings.
Previous analysis remains available for review. These changes reuse existing
status/message fields and require no database migration.

Run `node --import tsx scripts/automation-resilience.test.ts` for polling recovery,
no duplicate start requests, cancellation, empty evidence and partial-source
completion. `scripts/analysis-evidence.test.ts` covers actual route handling of
unreadable images and stale citation protection. The PowerPoint tests above also
verify skipped-brand placeholders and omission of retained findings.
