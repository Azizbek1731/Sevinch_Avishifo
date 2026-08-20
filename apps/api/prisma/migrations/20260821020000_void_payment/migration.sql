-- A payment entered by mistake is reversed, not deleted: the clinic's own
-- people must still be able to see the correction, even though the front desk
-- no longer does.
ALTER TYPE "PaymentStatus" ADD VALUE 'VOIDED';

ALTER TABLE "Payment" ADD COLUMN "voidedAt" TIMESTAMPTZ(6);
ALTER TABLE "Payment" ADD COLUMN "voidedById" TEXT;
ALTER TABLE "Payment" ADD COLUMN "voidReason" TEXT;
