-- The lab-service pipeline: a default Laboratoriya category for every clinic, and
-- lab attachments that know which order they belong to.

-- 1. A lab attachment (analyser printout, scanned form) is a patient document that
--    also points at its order, so the order can show its own files.
ALTER TABLE "PatientDocument" ADD COLUMN "labOrderId" TEXT;
ALTER TABLE "PatientDocument" ADD CONSTRAINT "PatientDocument_labOrderId_fkey"
  FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PatientDocument_labOrderId_idx" ON "PatientDocument"("labOrderId");

-- 2. Every clinic gets a default LAB service category. New clinics get it at
--    provisioning; this backfills the ones that already exist. Idempotent: only
--    clinics with no LAB-kind category receive one.
INSERT INTO "ServiceCategory" ("id", "clinicId", "name", "kind", "sortOrder", "isActive")
SELECT gen_random_uuid()::text, c.id, 'Laboratoriya', 'LAB'::"ServiceKind", 90, true
FROM "Clinic" c
WHERE NOT EXISTS (
  SELECT 1 FROM "ServiceCategory" sc
  WHERE sc."clinicId" = c.id AND sc.kind = 'LAB'::"ServiceKind"
);
