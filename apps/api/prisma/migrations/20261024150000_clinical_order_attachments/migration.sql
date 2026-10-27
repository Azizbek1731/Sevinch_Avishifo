-- UZI / clinical-order file attachments (mirrors labOrderId on PatientDocument).
ALTER TABLE "PatientDocument" ADD COLUMN IF NOT EXISTS "clinicalOrderId" TEXT;

CREATE INDEX IF NOT EXISTS "PatientDocument_clinicalOrderId_idx" ON "PatientDocument"("clinicalOrderId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PatientDocument_clinicalOrderId_fkey'
  ) THEN
    ALTER TABLE "PatientDocument"
      ADD CONSTRAINT "PatientDocument_clinicalOrderId_fkey"
      FOREIGN KEY ("clinicalOrderId") REFERENCES "ClinicalOrder"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
