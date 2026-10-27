-- Statsionar palatalar katalogi va 24 soatlik hisob soati.

CREATE TABLE "InpatientRoom" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT,
    "capacity" INTEGER NOT NULL,
    "pricePerDay" DECIMAL(14,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InpatientRoom_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InpatientRoom_branchId_floor_number_key" ON "InpatientRoom"("branchId", "floor", "number");
CREATE INDEX "InpatientRoom_clinicId_branchId_isActive_idx" ON "InpatientRoom"("clinicId", "branchId", "isActive");
CREATE INDEX "InpatientRoom_clinicId_floor_idx" ON "InpatientRoom"("clinicId", "floor");

ALTER TABLE "InpatientRoom" ADD CONSTRAINT "InpatientRoom_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Admission" ADD COLUMN "inpatientRoomId" TEXT;
ALTER TABLE "Admission" ADD COLUMN "roomBillingNextAt" TIMESTAMPTZ(6);

ALTER TABLE "Admission" ADD CONSTRAINT "Admission_inpatientRoomId_fkey"
  FOREIGN KEY ("inpatientRoomId") REFERENCES "InpatientRoom"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Admission_status_roomBillingNextAt_idx" ON "Admission"("status", "roomBillingNextAt");
CREATE INDEX "Admission_inpatientRoomId_status_idx" ON "Admission"("inpatientRoomId", "status");

-- Legacy calendar stays: keep charging from the stored next date at local midnight.
UPDATE "Admission"
SET "roomBillingNextAt" = (("roomBillingNextDate"::text || 'T00:00:00+05:00')::timestamptz)
WHERE "roomBillingNextDate" IS NOT NULL AND "roomBillingNextAt" IS NULL;

ALTER TABLE "AdmissionRoomCharge" ADD COLUMN "periodStartedAt" TIMESTAMPTZ(6);

UPDATE "AdmissionRoomCharge"
SET "periodStartedAt" = (("billingDate"::text || 'T00:00:00+05:00')::timestamptz)
WHERE "periodStartedAt" IS NULL;

CREATE INDEX "AdmissionRoomCharge_admissionId_periodStartedAt_idx"
  ON "AdmissionRoomCharge"("admissionId", "periodStartedAt");
