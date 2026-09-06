CREATE TYPE "ReportLanguage" AS ENUM ('HR', 'EN');

ALTER TABLE "Report"
ADD COLUMN "language" "ReportLanguage" NOT NULL DEFAULT 'HR';
