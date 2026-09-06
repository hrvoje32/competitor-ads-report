ALTER TABLE "Report"
ADD COLUMN "startDate" DATE,
ADD COLUMN "endDate" DATE;

UPDATE "Report"
SET
  "startDate" = make_date("year", "month", 2),
  "endDate" = (make_date("year", "month", 1) + INTERVAL '1 month' - INTERVAL '2 days')::date;

ALTER TABLE "Report"
ALTER COLUMN "startDate" SET NOT NULL,
ALTER COLUMN "endDate" SET NOT NULL;
