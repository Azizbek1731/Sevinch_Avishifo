/*
  Warnings:

  - A unique constraint covering the columns `[clinicId,systemKey]` on the table `ExpenseCategory` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SurgeryStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SurgeryEntryKind" AS ENUM ('MATERIAL', 'ANESTHESIA');

-- CreateEnum
CREATE TYPE "SurgeryPayoutType" AS ENUM ('PERCENT', 'FIXED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ServiceKind" ADD VALUE 'SURGERY';
ALTER TYPE "ServiceKind" ADD VALUE 'MATERIAL';
ALTER TYPE "ServiceKind" ADD VALUE 'MEDICINE';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'OPERATING_ROOM';

-- AlterTable
ALTER TABLE "ChargeItem" ADD COLUMN     "surgeryId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "systemKey" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'dona';

-- CreateTable
CREATE TABLE "SurgeryCase" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "surgeonUserId" TEXT NOT NULL,
    "serviceChargeId" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "status" "SurgeryStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "completedAt" TIMESTAMPTZ(6),
    "createdById" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SurgeryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryEntry" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "surgeryId" TEXT NOT NULL,
    "kind" "SurgeryEntryKind" NOT NULL,
    "serviceId" TEXT,
    "title" JSONB NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "chargeItemId" TEXT NOT NULL,
    "note" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryPayout" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "surgeryId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "SurgeryPayoutType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "basisAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "expenseId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "voidedAt" TIMESTAMPTZ(6),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "SurgeryPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryCase_serviceChargeId_key" ON "SurgeryCase"("serviceChargeId");

-- CreateIndex
CREATE INDEX "SurgeryCase_clinicId_branchId_scheduledDate_idx" ON "SurgeryCase"("clinicId", "branchId", "scheduledDate");

-- CreateIndex
CREATE INDEX "SurgeryCase_clinicId_admissionId_idx" ON "SurgeryCase"("clinicId", "admissionId");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryCase_clinicId_requestKey_key" ON "SurgeryCase"("clinicId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryEntry_chargeItemId_key" ON "SurgeryEntry"("chargeItemId");

-- CreateIndex
CREATE INDEX "SurgeryEntry_clinicId_surgeryId_idx" ON "SurgeryEntry"("clinicId", "surgeryId");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryEntry_surgeryId_requestKey_lineIndex_key" ON "SurgeryEntry"("surgeryId", "requestKey", "lineIndex");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryPayout_expenseId_key" ON "SurgeryPayout"("expenseId");

-- CreateIndex
CREATE INDEX "SurgeryPayout_clinicId_branchId_paidAt_idx" ON "SurgeryPayout"("clinicId", "branchId", "paidAt");

-- CreateIndex
CREATE INDEX "SurgeryPayout_clinicId_surgeryId_idx" ON "SurgeryPayout"("clinicId", "surgeryId");

-- CreateIndex
CREATE UNIQUE INDEX "SurgeryPayout_clinicId_requestKey_key" ON "SurgeryPayout"("clinicId", "requestKey");

-- CreateIndex
CREATE INDEX "ChargeItem_clinicId_surgeryId_idx" ON "ChargeItem"("clinicId", "surgeryId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_clinicId_systemKey_key" ON "ExpenseCategory"("clinicId", "systemKey");

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "SurgeryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryCase" ADD CONSTRAINT "SurgeryCase_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryCase" ADD CONSTRAINT "SurgeryCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryCase" ADD CONSTRAINT "SurgeryCase_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryCase" ADD CONSTRAINT "SurgeryCase_surgeonUserId_fkey" FOREIGN KEY ("surgeonUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryCase" ADD CONSTRAINT "SurgeryCase_serviceChargeId_fkey" FOREIGN KEY ("serviceChargeId") REFERENCES "ChargeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryEntry" ADD CONSTRAINT "SurgeryEntry_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "SurgeryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryEntry" ADD CONSTRAINT "SurgeryEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryEntry" ADD CONSTRAINT "SurgeryEntry_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryPayout" ADD CONSTRAINT "SurgeryPayout_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "SurgeryCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryPayout" ADD CONSTRAINT "SurgeryPayout_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryPayout" ADD CONSTRAINT "SurgeryPayout_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryPayout" ADD CONSTRAINT "SurgeryPayout_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
