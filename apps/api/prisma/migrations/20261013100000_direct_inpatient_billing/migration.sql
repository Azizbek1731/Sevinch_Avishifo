ALTER TABLE "TreatmentOrder"
  ADD COLUMN "billedOnOrder" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "billingChargeId" TEXT,
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

ALTER TABLE "ChargeItem"
  ADD COLUMN "requestKey" TEXT,
  ADD COLUMN "requestFingerprint" TEXT;

CREATE UNIQUE INDEX "TreatmentOrder_billingChargeId_key" ON "TreatmentOrder"("billingChargeId");
CREATE UNIQUE INDEX "TreatmentOrder_clinicId_admissionId_requestKey_key" ON "TreatmentOrder"("clinicId", "admissionId", "requestKey");
CREATE UNIQUE INDEX "ChargeItem_clinicId_requestKey_key" ON "ChargeItem"("clinicId", "requestKey");

ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_billingChargeId_fkey"
  FOREIGN KEY ("billingChargeId") REFERENCES "ChargeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
