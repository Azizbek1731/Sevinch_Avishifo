-- Attribution is separate from reception/cashier identity and survives staff renames.
ALTER TABLE "LabOrder"
  ADD COLUMN "referringDoctorUserId" TEXT,
  ADD COLUMN "referringDoctorName" TEXT;

-- Existing doctor-created orders retain their known referrer. Reception orders
-- are deliberately left unassigned rather than guessing from a patient/visit.
UPDATE "LabOrder" AS o
SET "referringDoctorUserId" = u.id, "referringDoctorName" = u."fullName"
FROM "User" AS u
WHERE u.id = o."orderedById" AND u."clinicId" = o."clinicId" AND u.role::text = 'DOCTOR';

CREATE INDEX "LabOrder_referring_doctor_date_idx"
ON "LabOrder"("clinicId", "branchId", "referringDoctorUserId", "createdAt");
