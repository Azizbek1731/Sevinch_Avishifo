-- AlterEnum
ALTER TYPE "ReferralType" ADD VALUE 'ULTRASOUND';

-- AlterTable
ALTER TABLE "Referral" ADD COLUMN "clinicalOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Referral_clinicalOrderId_key" ON "Referral"("clinicalOrderId");

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_clinicalOrderId_fkey" FOREIGN KEY ("clinicalOrderId") REFERENCES "ClinicalOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
