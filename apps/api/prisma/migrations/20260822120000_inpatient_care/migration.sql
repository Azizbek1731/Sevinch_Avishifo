-- Statsionar (inpatient) care: the hospital stay, its treatment sheet, and the
-- charge ledger that makes "pay some now, some later" possible for both
-- inpatients and outpatients.
--
-- Purely additive: new enums and tables only. Nothing existing changes shape,
-- so this is safe to apply while the API is serving.

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ACTIVE', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "OrderSchedule" AS ENUM ('DAILY', 'EVERY_OTHER_DAY', 'ONCE');

-- CreateEnum
CREATE TYPE "AdministrationStatus" AS ENUM ('GIVEN', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AdmissionOutcome" AS ENUM ('RECOVERED', 'IMPROVED', 'UNCHANGED', 'WORSE', 'TRANSFERRED', 'DIED');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'INVOICED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Admission" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "historyNumber" TEXT NOT NULL,
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "department" TEXT,
    "ward" TEXT,
    "bed" TEXT,
    "attendingDoctorUserId" TEXT,
    "admittedAt" TIMESTAMPTZ(6) NOT NULL,
    "dischargedAt" TIMESTAMPTZ(6),
    "referredBy" TEXT,
    "referralDiagnosis" TEXT,
    "admissionDiagnosis" TEXT,
    "clinicalDiagnosis" TEXT,
    "clinicalDiagnosisAt" DATE,
    "finalDiagnosisMain" TEXT,
    "finalDiagnosisComplication" TEXT,
    "finalDiagnosisComorbid" TEXT,
    "firstTimeThisYear" BOOLEAN,
    "outcome" "AdmissionOutcome",
    "complaints" TEXT,
    "anamnesisMorbi" TEXT,
    "anamnesisVitae" TEXT,
    "objectiveStatus" TEXT,
    "preliminaryDiagnosis" TEXT,
    "treatmentPlan" TEXT,
    "epicrisis" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Admission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentOrder" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "schedule" "OrderSchedule" NOT NULL,
    "startDate" DATE NOT NULL,
    "timesPlanned" INTEGER NOT NULL,
    "note" TEXT,
    "stoppedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentAdministration" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AdministrationStatus" NOT NULL,
    "markedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeItem" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "admissionId" TEXT,
    "visitId" TEXT,
    "administrationId" TEXT,
    "serviceId" TEXT,
    "title" JSONB NOT NULL,
    "date" DATE NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "invoiceLineId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionDailyNote" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "condition" TEXT NOT NULL,
    "temperatureC" DOUBLE PRECISION,
    "pulseBpm" INTEGER,
    "bpSystolic" INTEGER,
    "bpDiastolic" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdmissionDailyNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Admission_clinicId_status_idx" ON "Admission"("clinicId", "status");

-- CreateIndex
CREATE INDEX "Admission_clinicId_patientId_idx" ON "Admission"("clinicId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "Admission_clinicId_historyNumber_key" ON "Admission"("clinicId", "historyNumber");

-- CreateIndex
CREATE INDEX "TreatmentOrder_clinicId_admissionId_idx" ON "TreatmentOrder"("clinicId", "admissionId");

-- CreateIndex
CREATE INDEX "TreatmentAdministration_clinicId_date_idx" ON "TreatmentAdministration"("clinicId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentAdministration_orderId_date_key" ON "TreatmentAdministration"("orderId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeItem_administrationId_key" ON "ChargeItem"("administrationId");

-- CreateIndex
CREATE INDEX "ChargeItem_clinicId_patientId_status_idx" ON "ChargeItem"("clinicId", "patientId", "status");

-- CreateIndex
CREATE INDEX "ChargeItem_clinicId_admissionId_idx" ON "ChargeItem"("clinicId", "admissionId");

-- CreateIndex
CREATE INDEX "AdmissionDailyNote_clinicId_admissionId_date_idx" ON "AdmissionDailyNote"("clinicId", "admissionId", "date");

-- AddForeignKey
ALTER TABLE "Admission" ADD CONSTRAINT "Admission_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentOrder" ADD CONSTRAINT "TreatmentOrder_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentAdministration" ADD CONSTRAINT "TreatmentAdministration_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TreatmentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_administrationId_fkey" FOREIGN KEY ("administrationId") REFERENCES "TreatmentAdministration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionDailyNote" ADD CONSTRAINT "AdmissionDailyNote_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "Admission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

