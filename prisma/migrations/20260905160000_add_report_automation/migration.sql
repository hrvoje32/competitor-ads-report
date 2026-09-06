CREATE TYPE "AutomationStatus" AS ENUM ('PENDING', 'FETCHING', 'CAPTURING', 'ANALYSING', 'READY', 'FAILED');

CREATE TYPE "CaptureStatus" AS ENUM ('PENDING', 'CAPTURING', 'READY', 'FAILED');

ALTER TABLE "BrandReport"
ADD COLUMN "automationStatus" "AutomationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "googleStatus" "AutomationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "metaStatus" "AutomationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "automationError" TEXT,
ADD COLUMN "googleError" TEXT,
ADD COLUMN "metaError" TEXT,
ADD COLUMN "automationStartedAt" TIMESTAMP(3),
ADD COLUMN "automationEndedAt" TIMESTAMP(3);

ALTER TABLE "AdEvidence"
ADD COLUMN "captureStatus" "CaptureStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "captureError" TEXT,
ADD COLUMN "perceptualHash" TEXT,
ADD COLUMN "normalizedTextHash" TEXT,
ADD COLUMN "duplicateGroupKey" TEXT,
ADD COLUMN "duplicateGroupCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "representativeScore" DOUBLE PRECISION;

UPDATE "AdEvidence"
SET "captureStatus" = 'READY'
WHERE "localImagePath" IS NOT NULL;

CREATE TABLE "GoogleAdvertiserCandidate" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "disclosedName" TEXT,
  "legalName" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoogleAdvertiserCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoogleAdvertiserCandidate_brandId_advertiserId_key"
ON "GoogleAdvertiserCandidate"("brandId", "advertiserId");

CREATE INDEX "GoogleAdvertiserCandidate_brandId_confidence_idx"
ON "GoogleAdvertiserCandidate"("brandId", "confidence");

CREATE INDEX "AdEvidence_brandReportId_source_captureStatus_idx"
ON "AdEvidence"("brandReportId", "source", "captureStatus");

CREATE INDEX "AdEvidence_brandReportId_duplicateGroupKey_idx"
ON "AdEvidence"("brandReportId", "duplicateGroupKey");

ALTER TABLE "GoogleAdvertiserCandidate"
ADD CONSTRAINT "GoogleAdvertiserCandidate_brandId_fkey"
FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
