CREATE TYPE "ProviderRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PROCESSING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "AdMediaStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'STORED', 'FAILED');
CREATE TYPE "AdMediaKind" AS ENUM ('IMAGE', 'VIDEO_THUMBNAIL');

ALTER TABLE "BrandReport"
ADD COLUMN "googleMediaError" TEXT,
ADD COLUMN "metaMediaError" TEXT;

ALTER TABLE "AdEvidence"
ADD COLUMN "landingPageUrl" TEXT,
ADD COLUMN "description" TEXT,
ADD COLUMN "cta" TEXT,
ADD COLUMN "rawData" JSONB;

CREATE TABLE "AdProviderRun" (
  "id" TEXT NOT NULL,
  "brandReportId" TEXT NOT NULL,
  "source" "AdSource" NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'APIFY',
  "actorId" TEXT NOT NULL,
  "runId" TEXT,
  "datasetId" TEXT,
  "status" "ProviderRunStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "mediaStoredCount" INTEGER NOT NULL DEFAULT 0,
  "inputJson" JSONB,
  "itemsPersistedAt" TIMESTAMP(3),
  "processingStartedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdProviderRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdMedia" (
  "id" TEXT NOT NULL,
  "adEvidenceId" TEXT NOT NULL,
  "kind" "AdMediaKind" NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "storagePath" TEXT,
  "status" "AdMediaStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdMedia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdProviderRun_brandReportId_source_key" ON "AdProviderRun"("brandReportId", "source");
CREATE INDEX "AdProviderRun_status_updatedAt_idx" ON "AdProviderRun"("status", "updatedAt");
CREATE UNIQUE INDEX "AdMedia_adEvidenceId_sourceUrl_key" ON "AdMedia"("adEvidenceId", "sourceUrl");
CREATE INDEX "AdMedia_status_updatedAt_idx" ON "AdMedia"("status", "updatedAt");
CREATE INDEX "AdMedia_adEvidenceId_sortOrder_idx" ON "AdMedia"("adEvidenceId", "sortOrder");

ALTER TABLE "AdProviderRun" ADD CONSTRAINT "AdProviderRun_brandReportId_fkey"
FOREIGN KEY ("brandReportId") REFERENCES "BrandReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdMedia" ADD CONSTRAINT "AdMedia_adEvidenceId_fkey"
FOREIGN KEY ("adEvidenceId") REFERENCES "AdEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
