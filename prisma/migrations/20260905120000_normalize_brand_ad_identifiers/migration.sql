ALTER TABLE "Brand" ADD COLUMN "googleDomain" TEXT;

CREATE TABLE "GoogleAdvertiser" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "advertiserId" TEXT NOT NULL,
  "label" TEXT,
  CONSTRAINT "GoogleAdvertiser_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleAdvertiser_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MetaPage" (
  "id" TEXT NOT NULL,
  "brandId" TEXT NOT NULL,
  "pageId" TEXT NOT NULL,
  "pageName" TEXT,
  CONSTRAINT "MetaPage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MetaPage_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoogleAdvertiser_brandId_advertiserId_key" ON "GoogleAdvertiser"("brandId", "advertiserId");
CREATE INDEX "GoogleAdvertiser_brandId_idx" ON "GoogleAdvertiser"("brandId");
CREATE UNIQUE INDEX "MetaPage_brandId_pageId_key" ON "MetaPage"("brandId", "pageId");
CREATE INDEX "MetaPage_brandId_idx" ON "MetaPage"("brandId");

-- Preserve every legacy identifier before removing the single-value columns.
INSERT INTO "GoogleAdvertiser" ("id", "brandId", "advertiserId")
SELECT 'legacy-google-' || md5("id" || ':' || trim("googleAdvertiserId")), "id", trim("googleAdvertiserId")
FROM "Brand"
WHERE NULLIF(trim("googleAdvertiserId"), '') IS NOT NULL
ON CONFLICT ("brandId", "advertiserId") DO NOTHING;

INSERT INTO "MetaPage" ("id", "brandId", "pageId")
SELECT 'legacy-meta-' || md5("id" || ':' || trim("metaPageId")), "id", trim("metaPageId")
FROM "Brand"
WHERE NULLIF(trim("metaPageId"), '') IS NOT NULL
ON CONFLICT ("brandId", "pageId") DO NOTHING;

-- Recover a stable domain from a legacy domain-search URL when possible, then
-- fall back to the hostname of the brand website.
UPDATE "Brand"
SET "googleDomain" = lower(COALESCE(
  NULLIF(substring("googleTransparencyUrl" from '[?&]domain=([^&]+)'), ''),
  NULLIF(regexp_replace(regexp_replace("websiteUrl", '^https?://', '', 'i'), '/.*$', ''), '')
));

ALTER TABLE "Brand"
  DROP COLUMN "googleTransparencyUrl",
  DROP COLUMN "googleAdvertiserId",
  DROP COLUMN "metaAdLibraryUrl",
  DROP COLUMN "metaPageId";
