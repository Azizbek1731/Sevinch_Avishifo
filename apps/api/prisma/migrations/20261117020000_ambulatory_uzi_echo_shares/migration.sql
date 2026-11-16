-- Ambulator ulush: laboratoriya, UZI va EXO uchun alohida foizlar.

-- EXO (echo) examinations are ULTRASOUND services the clinic marks separately.
ALTER TABLE "Service" ADD COLUMN "isEcho" BOOLEAN NOT NULL DEFAULT false;

-- Referring doctor's share percents, snapshotted when the UZI order lands on a card.
ALTER TABLE "ClinicalOrder"
  ADD COLUMN "ambulatoryUziPercent" DECIMAL(5,2),
  ADD COLUMN "ambulatoryEchoPercent" DECIMAL(5,2);

-- Per-doctor overrides; null falls back to the clinic default of that group.
ALTER TABLE "AmbulatoryCommissionRate"
  ALTER COLUMN "percent" DROP NOT NULL,
  ADD COLUMN "uziPercent" DECIMAL(5,2),
  ADD COLUMN "echoPercent" DECIMAL(5,2);
