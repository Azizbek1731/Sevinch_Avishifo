-- CreateEnum
CREATE TYPE "SurgeryStaffRole" AS ENUM ('SURGEON', 'ANESTHESIOLOGIST', 'NURSE');

-- CreateTable
CREATE TABLE "SurgeryStaffFee" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "surgeryId" TEXT NOT NULL,
    "role" "SurgeryStaffRole" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "chargeItemId" TEXT NOT NULL,
    "note" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryStaffFee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryStaffFee_chargeItemId_key" ON "SurgeryStaffFee"("chargeItemId");

-- CreateIndex
CREATE INDEX "SurgeryStaffFee_clinicId_surgeryId_idx" ON "SurgeryStaffFee"("clinicId", "surgeryId");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryStaffFee_surgeryId_requestKey_lineIndex_key" ON "SurgeryStaffFee"("surgeryId", "requestKey", "lineIndex");

-- AddForeignKey
ALTER TABLE "SurgeryStaffFee" ADD CONSTRAINT "SurgeryStaffFee_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "SurgeryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryStaffFee" ADD CONSTRAINT "SurgeryStaffFee_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

