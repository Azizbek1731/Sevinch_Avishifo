-- Referring-doctor share for ozone / hydrocolonotherapy (ambulatory card charges).
ALTER TABLE "AmbulatoryCommissionRate"
  ADD COLUMN IF NOT EXISTS "therapyPercent" DECIMAL(5,2);

ALTER TABLE "ChargeItem"
  ADD COLUMN IF NOT EXISTS "ambulatoryCommissionPercent" DECIMAL(5,2);
