-- The transfer register becomes a real ledger instead of a reconstruction.
--
-- Until now only CASH payments carried a shiftId; the "o'tkazma kassa" figure
-- was re-derived on every read from whoever received the money inside the
-- shift's time window. That guess is replaced by a link, which means the
-- figure a cashier watches and the figure printed when the drawer closes are
-- finally the same number.

-- ---------------------------------------------------------------- registers
ALTER TABLE "CashierShift" ADD COLUMN "expectedTransfer" DECIMAL(14,2);
ALTER TABLE "CashierShift" ADD COLUMN "actualTransfer" DECIMAL(14,2);
ALTER TABLE "CashierShift" ADD COLUMN "transferUnverifiedReason" TEXT;
ALTER TABLE "CashierShift" ADD COLUMN "closedById" TEXT;

CREATE INDEX "CashierShift_clinicId_branchId_openedAt_idx"
  ON "CashierShift"("clinicId", "branchId", "openedAt");

-- ----------------------------------------------------------- deposit leak
-- Taking a deposit has always required an open drawer because the cash goes
-- into it, but nothing recorded which drawer — so every cash deposit closed
-- the register over by its own amount.
ALTER TABLE "PatientBalanceTransaction" ADD COLUMN "shiftId" TEXT;
ALTER TABLE "PatientBalanceTransaction" ADD COLUMN "method" "PaymentMethod";

ALTER TABLE "PatientBalanceTransaction" ADD CONSTRAINT "PatientBalanceTransaction_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PatientBalanceTransaction_clinicId_shiftId_idx"
  ON "PatientBalanceTransaction"("clinicId", "shiftId");

-- --------------------------------------------------------- access patterns
CREATE INDEX "Payment_shiftId_method_status_idx" ON "Payment"("shiftId", "method", "status");
CREATE INDEX "Refund_shiftId_method_idx" ON "Refund"("shiftId", "method");

-- ------------------------------------------------------------- continuity
-- Backfill, rather than closing every open drawer at release.
--
-- A shift that spans this release would otherwise lose its whole transfer
-- figure the moment the code stops guessing: the payments it already took
-- carry no shiftId, so they would simply vanish from the total. Linking them
-- with EXACTLY the rule the old code used (same receiver, same branch, inside
-- the shift window) keeps every open drawer showing the same number after the
-- deploy as before it, and nobody has to be told their shift was closed for
-- them.
--
-- Deliberately restricted to OPEN shifts. A closed shift's expectedCash and
-- actualCash are stored, signed off, and none of our business now.
UPDATE "Payment" p
SET "shiftId" = s."id"
FROM "CashierShift" s
WHERE p."shiftId" IS NULL
  AND p."method"::text IN ('CARD', 'PAYME', 'CLICK', 'UZUM')
  AND p."status"::text = 'COMPLETED'
  AND s."status" = 'OPEN'
  AND s."clinicId" = p."clinicId"
  AND s."branchId" = p."branchId"
  AND s."cashierUserId" = p."receivedById"
  AND p."paidAt" >= s."openedAt";

UPDATE "Refund" r
SET "shiftId" = s."id"
FROM "CashierShift" s, "Invoice" i
WHERE r."shiftId" IS NULL
  AND r."method"::text IN ('CARD', 'PAYME', 'CLICK', 'UZUM')
  AND i."id" = r."invoiceId"
  AND s."status" = 'OPEN'
  AND s."clinicId" = r."clinicId"
  AND s."branchId" = i."branchId"
  AND s."cashierUserId" = r."createdById"
  AND r."createdAt" >= s."openedAt";

-- --------------------------------------------------------------- integrity
-- open() is a check-then-insert with no transaction, so two quick taps could
-- leave one person holding two drawers in one branch — and the eight
-- findFirst call sites would then pick between them arbitrarily.
--
-- NOTE: this partial index cannot be expressed in schema.prisma. `prisma
-- migrate dev` will report drift and offer to drop it. Keep it.
CREATE UNIQUE INDEX "CashierShift_one_open_per_user_per_branch"
  ON "CashierShift"("cashierUserId", "branchId")
  WHERE "status" = 'OPEN';
