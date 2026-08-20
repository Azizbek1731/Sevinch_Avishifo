-- An expense has to say where the money came from. Cash out of a drawer must
-- reduce that shift's expected total, or the cashier is short at closing time
-- for a payment the clinic itself authorised.
ALTER TABLE "Expense" ADD COLUMN "method" "PaymentMethod" NOT NULL DEFAULT 'CASH';
ALTER TABLE "Expense" ADD COLUMN "shiftId" TEXT;

-- Withdrawn, not deleted: a closed shift that already reconciled against this
-- row still has to be explainable afterwards.
ALTER TABLE "Expense" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
ALTER TABLE "Expense" ADD COLUMN "deletedById" TEXT;

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Expense_clinicId_shiftId_idx" ON "Expense"("clinicId", "shiftId");
