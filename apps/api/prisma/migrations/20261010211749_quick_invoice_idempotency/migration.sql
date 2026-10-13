/*
  Warnings:

  - A unique constraint covering the columns `[clinicId,requestKey]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "requestFingerprint" TEXT,
ADD COLUMN     "requestKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clinicId_requestKey_key" ON "Invoice"("clinicId", "requestKey");
