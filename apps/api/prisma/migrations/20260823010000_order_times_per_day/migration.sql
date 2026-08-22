-- Orders gain "how many times within a day" ("kunida 2 mahal"), and each
-- administration mark records WHICH dose of the day it is. Existing rows are
-- one-dose-a-day, which both defaults express exactly, so no backfill is needed.

ALTER TABLE "TreatmentOrder" ADD COLUMN "timesPerDay" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TreatmentAdministration" ADD COLUMN "slot" INTEGER NOT NULL DEFAULT 1;

-- The day is no longer the unit of uniqueness — the dose is.
DROP INDEX "TreatmentAdministration_orderId_date_key";
CREATE UNIQUE INDEX "TreatmentAdministration_orderId_date_slot_key"
  ON "TreatmentAdministration"("orderId", "date", "slot");
