/*
  Warnings:

  - A unique constraint covering the columns `[invoiceId]` on the table `LabOrder` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "clinicalOrderId" TEXT;

-- AlterTable
ALTER TABLE "LabOrder" ADD COLUMN     "invoiceId" TEXT;

-- AlterTable
ALTER TABLE "LabResult" ADD COLUMN     "reportDocumentId" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "kind" "ServiceKind" NOT NULL DEFAULT 'CONSULTATION',
ADD COLUMN     "reportBody" TEXT,
ADD COLUMN     "reportTitle" TEXT;

-- CreateTable
CREATE TABLE "ClinicalOrder" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorUserId" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "initialInvoiceId" TEXT NOT NULL,
    "visitId" TEXT,
    "note" TEXT,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ClinicalOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_initialInvoiceId_key" ON "ClinicalOrder"("initialInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_visitId_key" ON "ClinicalOrder"("visitId");

-- CreateIndex
CREATE INDEX "ClinicalOrder_clinicId_branchId_createdAt_idx" ON "ClinicalOrder"("clinicId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalOrder_clinicId_doctorUserId_createdAt_idx" ON "ClinicalOrder"("clinicId", "doctorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ClinicalOrder_clinicId_patientId_idx" ON "ClinicalOrder"("clinicId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalOrder_clinicId_requestKey_key" ON "ClinicalOrder"("clinicId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_invoiceId_key" ON "LabOrder"("invoiceId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clinicalOrderId_fkey" FOREIGN KEY ("clinicalOrderId") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_reportDocumentId_fkey" FOREIGN KEY ("reportDocumentId") REFERENCES "PatientDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_doctorUserId_fkey" FOREIGN KEY ("doctorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_initialInvoiceId_fkey" FOREIGN KEY ("initialInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalOrder" ADD CONSTRAINT "ClinicalOrder_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
