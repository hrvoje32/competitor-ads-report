# Creative capture review

Browserless connection and the Google BigQuery / Meta API collectors are unchanged.
The detector prioritizes the existing source selectors, ranks visible candidates by
area, and then checks media and creative containers. It excludes small decorations
and navigation. If no usable crop can be captured, the viewport becomes evidence,
with edge navigation cropped when measurable. `captureStatus` is `READY` after
storage succeeds; `captureMethod` distinguishes `CREATIVE` from `PAGE_FALLBACK`.
The evidence card labels page fallbacks for review and manual cropping.

If a Meta `/ads/archive/render_ad/` snapshot returns HTTP 404 or 410, capture
tries `https://www.facebook.com/ads/library/?id=AD_ID` once for the same numeric
Library ID. The alternate URL contains no token. Other HTTP errors remain hard
failures, as do unavailable-content pages returned with HTTP 200. This recovery
does not change Meta API collection or the stored source URLs.

Apply the additive `20261004090000_add_capture_method` database migration before
deploying this code, and generate the Prisma client as part of the build. Neither
the migration nor a deployment is performed by the diagnostic command.

## Bounded Browserless inspection

Run with `DATABASE_URL` and the working `BROWSER_WS_ENDPOINT` supplied securely by
the execution environment. Do not use an env-file loader or put secrets in command
arguments. The output directory must not exist yet; its parent must exist.

```sh
node --import tsx scripts/diagnose-creative-capture.ts BRAND_REPORT_ID /tmp/capture-review-1
```

This reads the first existing Google ad and first existing Meta ad for that brand
report. It attempts at most two ad URLs, with no retries on other records. It does
not collect ads, update the database, upload to storage, trigger report automation,
or start analysis. It saves a processed evidence image, an optional diagnostic
full-page PNG, and sanitized selector diagnostics for each source. Optional
full-page screenshot failure does not invalidate a successful evidence capture.
The full-page image shows the page before element capture scrolls it.

Diagnostics include source, final URL without credentials/query/fragment, sanitized
title, selector, match count, and up to 50 visible candidate dimensions per
selector. Candidates beyond that log limit still participate in selection. On a
page fallback the same diagnostics are logged on Vercel. Full-page diagnostics are
off during normal automated and manual capture; only this command enables them.

Review these two samples before any wider capture run. Existing production polling,
capture limits, evidence selection, and collection behavior have not been changed.
No live captures are triggered by the fixture tests.
