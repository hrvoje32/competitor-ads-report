ALTER TABLE "BrandReport"
ADD COLUMN "previousBrandReportId" TEXT;

CREATE INDEX "BrandReport_previousBrandReportId_idx"
ON "BrandReport"("previousBrandReportId");

ALTER TABLE "BrandReport"
ADD CONSTRAINT "BrandReport_previousBrandReportId_fkey"
FOREIGN KEY ("previousBrandReportId") REFERENCES "BrandReport"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
