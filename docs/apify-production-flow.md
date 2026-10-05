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

No new schema migration or environment variable is required. Existing Vercel
Apify and Supabase settings remain in use. `.env.local` was not used.

## Verification

Run `node --import tsx scripts/apify-media.test.ts` for the direct media,
mocked Supabase, no-browser, budgets, concurrency, reuse, filtering, partial
analysis and actual three-slide PowerPoint export tests. Run
`scripts/provider-switching.test.ts` for independent provider choices and paid
actor reuse. Other official capture/filter/analysis tests remain applicable.
Tests intercept network calls and do not launch paid actors or write to
production storage.
