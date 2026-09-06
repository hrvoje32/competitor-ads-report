import assert from "node:assert/strict";
import { deliveryOverlapsAnalysisPeriod, reportPeriod } from "../lib/report-period";
import { googleApifyProvider } from "../lib/ad-providers/google/apify";
import { metaApifyProvider } from "../lib/ad-providers/meta/apify";

assert.deepEqual(reportPeriod(2026, 8), { startDate: "2026-08-02", endDate: "2026-08-30" });
assert.deepEqual(reportPeriod(2026, 9), { startDate: "2026-09-02", endDate: "2026-09-29" });
assert.deepEqual(reportPeriod(2027, 2), { startDate: "2027-02-02", endDate: "2027-02-27" });
assert.deepEqual(reportPeriod(2028, 2), { startDate: "2028-02-02", endDate: "2028-02-28" });

const august = reportPeriod(2026, 8);
const september = reportPeriod(2026, 9);
const october = reportPeriod(2026, 10);
const overlaps = (from: string, to: string, period: { startDate: string; endDate: string }) =>
  deliveryOverlapsAnalysisPeriod(`${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`, period.startDate, period.endDate);

assert.equal(overlaps("2026-08-01", "2026-09-01", august), true, "Ad A must be included in August");
assert.equal(overlaps("2026-08-01", "2026-09-01", september), false, "Ad A must not be included in September");
assert.equal(overlaps("2026-09-01", "2026-10-01", september), true, "Ad B must be included in September");
assert.equal(overlaps("2026-09-01", "2026-10-01", october), false, "Ad B must not be included in October");
assert.equal(overlaps("2026-08-31", "2026-08-31", august), false, "Ad C must not be included in August");
assert.equal(overlaps("2026-08-15", "2026-09-15", august), true, "Ad D must be included in August");
assert.equal(overlaps("2026-08-15", "2026-09-15", september), true, "Ad D must be included in September");

const request = { brandName: "Example", googleDomain: "example.com", metaPageIds: ["123"], countryCode: "HR", ...august };
const googleInput = googleApifyProvider(request).input;
const metaInput = metaApifyProvider(request).input;
assert.equal(googleInput.startDate, "2026-08-02");
assert.equal(googleInput.endDate, "2026-08-30");
assert.equal(metaInput.dateFrom, "2026-08-02");
assert.equal(metaInput.dateTo, "2026-08-30");

console.log("Core-month report-period tests passed.");
