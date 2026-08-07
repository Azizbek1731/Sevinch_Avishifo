-- CreateEnum
CREATE TYPE "RecordAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'REVOKED');

-- AlterTable: opt-in Telegram second factor. Defaults off so nobody is locked
-- out by the migration itself; it is also ignored while telegramChatId is null.
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MedicalRecordAccess" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "RecordAccessStatus" NOT NULL DEFAULT 'PENDING',
    "patientNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MedicalRecordAccess_pkey" PRIMARY KEY ("id")
);

-- A patient belongs to exactly one clinic, so one row per patient: a re-request
-- updates the existing row rather than piling up history, and the staff inbox
-- never shows the same patient twice.
CREATE UNIQUE INDEX "MedicalRecordAccess_patientId_key" ON "MedicalRecordAccess"("patientId");

-- Drives the pending-requests inbox.
CREATE INDEX "MedicalRecordAccess_clinicId_status_requestedAt_idx" ON "MedicalRecordAccess"("clinicId", "status", "requestedAt");

ALTER TABLE "MedicalRecordAccess" ADD CONSTRAINT "MedicalRecordAccess_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
