-- Ambulator karta: services added to the card by hand (EKG, procedures, free-text lines).

-- AlterTable
ALTER TABLE "ChargeItem" ADD COLUMN "ambulatoryCaseId" TEXT;

-- CreateIndex
CREATE INDEX "ChargeItem_clinicId_ambulatoryCaseId_idx" ON "ChargeItem"("clinicId", "ambulatoryCaseId");

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_ambulatoryCaseId_fkey" FOREIGN KEY ("ambulatoryCaseId") REFERENCES "AmbulatoryCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
