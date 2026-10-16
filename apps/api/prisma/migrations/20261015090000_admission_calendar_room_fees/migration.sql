ALTER TABLE "Admission"
  ADD COLUMN "dailyRoomRate" DECIMAL(14,2),
  ADD COLUMN "roomBillingStartsOn" DATE,
  ADD COLUMN "roomBillingNextDate" DATE,
  ADD COLUMN "roomRateSetById" TEXT;

CREATE TABLE "AdmissionRoomCharge" (
  "id" TEXT NOT NULL,
  "clinicId" TEXT NOT NULL,
  "admissionId" TEXT NOT NULL,
  "billingDate" DATE NOT NULL,
  "dailyRate" DECIMAL(14,2) NOT NULL,
  "ward" TEXT,
  "bed" TEXT,
  "chargeItemId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdmissionRoomCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdmissionRoomCharge_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdmissionRoomCharge_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AdmissionRoomCharge_dailyRate_check" CHECK ("dailyRate" >= 0)
);

CREATE UNIQUE INDEX "AdmissionRoomCharge_chargeItemId_key" ON "AdmissionRoomCharge"("chargeItemId");
CREATE UNIQUE INDEX "AdmissionRoomCharge_admissionId_billingDate_key" ON "AdmissionRoomCharge"("admissionId", "billingDate");
CREATE INDEX "AdmissionRoomCharge_clinicId_admissionId_idx" ON "AdmissionRoomCharge"("clinicId", "admissionId");
CREATE INDEX "Admission_status_roomBillingNextDate_idx" ON "Admission"("status", "roomBillingNextDate");

ALTER TABLE "Admission" ADD CONSTRAINT "Admission_dailyRoomRate_check" CHECK ("dailyRoomRate" IS NULL OR "dailyRoomRate" >= 0);
