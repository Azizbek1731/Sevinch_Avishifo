-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "checkoutId" TEXT;

-- CreateTable
CREATE TABLE "PaymentCheckout" (
    "id" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "invoiceSnapshots" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentCheckout_clinicId_branchId_createdAt_idx" ON "PaymentCheckout"("clinicId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentCheckout_clinicId_patientId_idx" ON "PaymentCheckout"("clinicId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCheckout_clinicId_requestKey_key" ON "PaymentCheckout"("clinicId", "requestKey");

-- CreateIndex
CREATE INDEX "Payment_checkoutId_idx" ON "Payment"("checkoutId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "PaymentCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

