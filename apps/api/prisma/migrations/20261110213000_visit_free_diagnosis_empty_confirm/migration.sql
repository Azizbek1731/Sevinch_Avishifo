-- Free-text diagnosis on the visit sheet + empty confirmation reason.
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "diagnosisPrimary" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "diagnosisSecondary" TEXT;
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "emptyConfirmReason" TEXT;

-- Optional uploaded document attached to a visit (substitute for an empty sheet).
ALTER TABLE "PatientDocument" ADD COLUMN IF NOT EXISTS "visitId" TEXT;

CREATE INDEX IF NOT EXISTS "PatientDocument_visitId_idx" ON "PatientDocument"("visitId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'PatientDocument_visitId_fkey'
  ) THEN
    ALTER TABLE "PatientDocument"
      ADD CONSTRAINT "PatientDocument_visitId_fkey"
      FOREIGN KEY ("visitId") REFERENCES "Visit"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
