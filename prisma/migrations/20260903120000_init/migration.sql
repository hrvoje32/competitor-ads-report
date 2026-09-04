CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'COMPLETE');
CREATE TYPE "AdSource" AS ENUM ('GOOGLE', 'META');

CREATE TABLE "Report" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "countryCode" TEXT NOT NULL DEFAULT 'HR',
  "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Brand" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "logoPath" TEXT,
  "websiteUrl" TEXT,
  "googleTransparencyUrl" TEXT,
  "googleAdvertiserId" TEXT,
  "metaAdLibraryUrl" TEXT,
  "metaPageId" TEXT,
  "countryCode" TEXT NOT NULL DEFAULT 'HR',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");

CREATE TABLE "BrandReport" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "included" BOOLEAN NOT NULL DEFAULT true,
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "analysisJson" TEXT,
  "analysisEditedJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BrandReport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BrandReport_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BrandReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandReport_reportId_brandId_key" ON "BrandReport"("reportId", "brandId");

CREATE TABLE "AdEvidence" (
  "id" TEXT NOT NULL,
  "brandReportId" TEXT NOT NULL,
  "source" "AdSource" NOT NULL,
  "externalId" TEXT,
  "sourceUrl" TEXT,
  "snapshotUrl" TEXT,
  "localImagePath" TEXT,
  "headline" TEXT,
  "body" TEXT,
  "platform" TEXT,
  "format" TEXT,
  "firstShown" TIMESTAMP(3),
  "lastShown" TIMESTAMP(3),
  "reachLower" INTEGER,
  "reachUpper" INTEGER,
  "selectedForSlide" BOOLEAN NOT NULL DEFAULT false,
  "selectedForAnalysisEvidence" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "cropX" DOUBLE PRECISION,
  "cropY" DOUBLE PRECISION,
  "cropWidth" DOUBLE PRECISION,
  "cropHeight" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdEvidence_brandReportId_fkey" FOREIGN KEY ("brandReportId") REFERENCES "BrandReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdEvidence_pkey" PRIMARY KEY ("id")
);
