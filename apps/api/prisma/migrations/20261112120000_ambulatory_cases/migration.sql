-- Ambulator karta: walk-in patient of one doctor; lab sent from it earns the doctor a share.

-- CreateEnum
CREATE TYPE "AmbulatoryCaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "AmbulatoryCase" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "AmbulatoryCaseStatus" NOT NULL DEFAULT 'OPEN',
    "doctorUserId" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "complaint" TEXT,
    "diagnosis" TEXT,
    "note" TEXT,
    "openedAt" TIMESTAMPTZ(6) NOT NULL,
    "closedAt" TIMESTAMPTZ(6),
    "openedById" TEXT,
    "closedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AmbulatoryCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmbulatoryCommissionRate" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AmbulatoryCommissionRate_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "LabOrder"
  ADD COLUMN "ambulatoryCaseId" TEXT,
  ADD COLUMN "ambulatoryCommissionPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "ClinicalOrder" ADD COLUMN "ambulatoryCaseId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AmbulatoryCase_clinicId_number_key" ON "AmbulatoryCase"("clinicId", "number");
CREATE INDEX "AmbulatoryCase_clinicId_branchId_status_openedAt_idx" ON "AmbulatoryCase"("clinicId", "branchId", "status", "openedAt");
CREATE INDEX "AmbulatoryCase_clinicId_doctorUserId_openedAt_idx" ON "AmbulatoryCase"("clinicId", "doctorUserId", "openedAt");
CREATE INDEX "AmbulatoryCase_clinicId_patientId_idx" ON "AmbulatoryCase"("clinicId", "patientId");
CREATE UNIQUE INDEX "AmbulatoryCommissionRate_clinicId_doctorUserId_key" ON "AmbulatoryCommissionRate"("clinicId", "doctorUserId");
CREATE INDEX "LabOrder_clinicId_ambulatoryCaseId_idx" ON "LabOrder"("clinicId", "ambulatoryCaseId");
CREATE INDEX "ClinicalOrder_clinicId_ambulatoryCaseId_idx" ON "ClinicalOrder"("clinicId", "ambulatoryCaseId");

-- One open card per patient and doctor in a branch: a second one would split the same referrals.
CREATE UNIQUE INDEX "AmbulatoryCase_one_open_per_doctor"
ON "AmbulatoryCase"("clinicId", "branchId", "patientId", "doctorUserId")
WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "AmbulatoryCase" ADD CONSTRAINT "AmbulatoryCase_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_ambulatoryCaseId_fkey" FOREIGN KEY ("ambulatoryCaseId") REFERENCES "AmbulatoryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_ambulatoryCaseId_fkey" FOREIGN KEY ("ambulatoryCaseId") REFERENCES "AmbulatoryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
