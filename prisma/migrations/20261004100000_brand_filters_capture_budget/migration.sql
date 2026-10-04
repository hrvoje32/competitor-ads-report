BEGIN;

ALTER TABLE "Brand"
  ADD COLUMN "adIncludeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "adExcludeKeywords" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "adAllowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "adExcludedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AdEvidence"
  ADD COLUMN "brandFilterStatus" TEXT NOT NULL DEFAULT 'INCLUDED',
  ADD COLUMN "brandFilterReason" TEXT NOT NULL DEFAULT 'Included: no brand filters configured',
  ADD COLUMN "captureCandidateRank" INTEGER,
  ADD COLUMN "officialCaptureAttemptedAt" TIMESTAMP(3);

ALTER TABLE "BrandReport" ADD COLUMN "analysisNeedsRegeneration" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "OfficialCaptureState" (
  "id" TEXT NOT NULL,
  "brandReportId" TEXT NOT NULL,
  "source" "AdSource" NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT,
  "leaseStartedAt" TIMESTAMP(3),
  CONSTRAINT "OfficialCaptureState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OfficialCaptureState_brandReportId_fkey" FOREIGN KEY ("brandReportId") REFERENCES "BrandReport"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OfficialCaptureState_brandReportId_source_key" ON "OfficialCaptureState"("brandReportId", "source");

-- Preserve prior usage conservatively. Never delete or recapture existing media.
-- Historic logs cannot reconstruct exact Browserless usage, so count recorded
-- captured/failed/in-progress official evidence, capped at the new ceiling.
INSERT INTO "OfficialCaptureState" ("id", "brandReportId", "source", "attempts")
SELECT 'legacy_' || r."id", r."brandReportId", r."source",
  LEAST(8, COUNT(e."id"))::INTEGER
FROM "AdProviderRun" r LEFT JOIN "AdEvidence" e
  ON e."brandReportId" = r."brandReportId" AND e."source" = r."source"
  AND (e."localImagePath" IS NOT NULL OR e."captureStatus" IN ('CAPTURING', 'CAPTURE_FAILED'))
WHERE r."provider" = 'OFFICIAL'
GROUP BY r."id", r."brandReportId", r."source";

UPDATE "AdEvidence" e SET "officialCaptureAttemptedAt" = e."updatedAt"
FROM "AdProviderRun" r
WHERE r."brandReportId" = e."brandReportId" AND r."source" = e."source"
  AND r."provider" = 'OFFICIAL'
  AND (e."localImagePath" IS NOT NULL OR e."captureStatus" IN ('CAPTURING', 'CAPTURE_FAILED'));

COMMIT;
