# Official collection and capture review

Google BigQuery and Meta API authentication and requests are unchanged. Their
normalizers now retain the available owner/legal-name metadata for filtering.
Apify retains its existing provider, media download flow, and eight-image limit;
configured brand filters also protect its evidence from cross-brand selection.

## Database changes

Migration: `prisma/migrations/20261004100000_brand_filters_capture_budget/migration.sql`.

- `Brand`: four string arrays, default empty: `adIncludeKeywords`,
  `adExcludeKeywords`, `adAllowedDomains`, `adExcludedDomains`.
- `AdEvidence`: filter status/reason, nullable candidate rank and official attempt
  timestamp. Existing rows default to included. No records/images are deleted.
- `OfficialCaptureState`: one row per brand report/source, with persistent attempts
  and a capture lease. Regeneration/provider switching does not reset its budget.
- `BrandReport.analysisNeedsRegeneration`: defaults false. If filter changes exclude
  selected evidence, retained analysis stays inspectable but must be regenerated
  before export.

Apply this additive migration on Supabase before deploying the new application.
Use `prisma migrate deploy` with production database credentials supplied securely,
or apply the SQL manually and then mark that migration applied with Prisma.
The normal build generates the Prisma client. No new environment variable is needed.

Existing official capture usage is conservatively backfilled from stored,
failed, and in-progress evidence, capped at eight. Old logs do not distinguish all
skipped records from attempted records, so some old reports may have an exhausted
budget. New reports have precise counters. Existing reports with over five images
keep those files; official capture adds no more. No automatic budget reset is offered.

## Brand matching

`lib/brand-ad-filter.ts` performs accent-insensitive whole-word/phrase matching and
hostname/subdomain matching. A lookalike such as `peugeot.hr.attacker.test` does not
match `peugeot.hr`. URL query strings do not establish domain ownership, and no
network request is made to resolve destinations during filtering.

Precedence: reject a wrong configured Meta Page ID; reject excluded domains or
explicit excluded creative text; reject a known landing domain outside an explicit
allowlist; include allowed domains or creative-text matches; reject excluded owner
metadata before considering a saved Meta Page ID or included owner alias. This lets
a Peugeot destination outweigh weak multi-marque agency metadata, while an explicit
Fiat creative is excluded even if its advertiser name mentions Peugeot.

With positive filters configured, missing brand metadata is **excluded with a
reason**, not guessed from the advertiser ID. BigQuery often cannot identify the
marque from an agency's record, so a report may have zero Google candidates until
metadata is added/reviewed or another source provides it. Empty filters preserve
previous behavior. No Peugeot-specific values are automatically saved to a brand.

Every retained record has an INCLUDED/EXCLUDED reason. Editing filters re-evaluates
existing evidence without recapturing it. Review has Included, Excluded and All views.

## Candidate selection and spending limits

`lib/official-capture-policy.ts` contains:

```ts
MAX_OFFICIAL_CREATIVE_CAPTURES_PER_SOURCE = 5
MAX_OFFICIAL_CAPTURE_ATTEMPTS_PER_SOURCE = 8
```

Before opening a browser, records are grouped by creative ID, canonical URL
(tracking/auth parameters removed), and identical meaningful copy plus format and
landing URL. Transitive duplicate groups retain the stored member when available.
The ranked plan prefers stored evidence, then unseen formats/messages/landing URLs/
campaigns and recent delivery. Up to eight distinct candidates are retained per source.

`lib/official-capture.ts` reserves an attempt in the database before connecting to
Browserless. One poll makes at most one attempt per source. Failures—including
connection and storage failures—consume attempts but not successful screenshot
slots. A lease serializes concurrent requests; expiry/crashes do not restore spent
attempts. Captures stop at five stored screenshots, eight attempts, or no candidates.
The same guard applies to manual official capture. Saved screenshots are reused.
The maximum is 16 official Browserless sessions per brand report. A session may
perform the existing same-ad Meta URL fallback; that is not another browser session.

The review counts show collected, included, excluded, candidate, attempt and stored
totals independently for Google and Meta. Stored totals include retained historical
images; excluded images remain inspectable and are never used in new analysis.

## Capture and analysis

Creative detection prefers source selectors, then large visible media, then creative
containers. A rendered ad page can use a cropped viewport fallback, labelled
`PAGE_FALLBACK`. Exact crops retain the existing `CREATIVE` label for compatibility.
Blank/unidentified navigation, login, CAPTCHA/block, screenshot and storage failures
remain failures. The existing safe Meta snapshot authentication is unchanged.

Analysis uses selected, included evidence with stored screenshots; current image
reads are validated before calling AI; unreadable/corrupt files and their metadata
are omitted while remaining usable evidence can still be analysed. It does not require five images per source.
Previous-month metadata is restricted to eligible selected records with retained
screenshots; previous free-form AI summaries are no longer supplied, because they
may refer to ads excluded by current filters. If old screenshots were cleaned up,
those records remain available for manual review but aren't included in new analysis.

## Verification

- `scripts/brand-filter-selection.test.ts`: aliases, exclusions, accent and domain
  boundaries, Page IDs, no-config defaults, transitive deduplication, diversity,
  existing evidence, and five Google plus three Meta eligible analysis records.
- `scripts/official-capture-budget.test.ts`: actual capture orchestration against
  mocked browser/storage/database; five successes in seven attempts, eight failures,
  separate source budgets, no recapture, fewer candidates, upload errors and overlap.
- `scripts/provider-switching.test.ts`: official/Apify switching, collection claims,
  retained images and excluded records, authentication and paid-fallback behavior.
- Existing browser fixtures cover creative ranking, page fallback, blank/login/block
  rejection, screenshot/storage errors and diagnostic redaction.

No production collection, live capture, migration, or deployment is performed by
these tests. Do not load `.env.local` to run them.
