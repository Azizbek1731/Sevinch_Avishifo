-- One register per branch, with an opening figure for both books.
--
-- The per-user drawers confused the people using them: the owner, reception
-- and the cashier each saw "the" register and each saw a different one. The
-- clinics this is sold to run one physical cash box per branch, so the model
-- now matches: whoever opens the register opens it for the branch, everyone
-- sees the same numbers, and every payment still records who took it.

ALTER TABLE "CashierShift" ADD COLUMN "openingTransfer" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Collapse today's duplicates before the uniqueness rule lands. Per branch,
-- the OPEN shift with the most money linked to it survives (latest opened as
-- the tie-break); the rest are empty side-drawers people opened by accident.
-- Their expected/actual stay NULL — no count happened, and inventing one is
-- exactly what this system refuses to do.
WITH ranked AS (
  SELECT s.id,
         ROW_NUMBER() OVER (
           PARTITION BY s."branchId"
           ORDER BY (SELECT COUNT(*) FROM "Payment" p WHERE p."shiftId" = s.id) DESC,
                    s."openedAt" DESC
         ) AS rn
  FROM "CashierShift" s
  WHERE s.status = 'OPEN'
)
UPDATE "CashierShift" c
SET status = 'CLOSED',
    "closedAt" = now(),
    note = COALESCE(note || ' ', '') || '[Avtomatik yopildi: filialda bitta kassa qoldi]'
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- NOTE: partial indexes cannot be expressed in schema.prisma; `prisma migrate
-- dev` will report drift and offer to drop them. Keep them.
DROP INDEX IF EXISTS "CashierShift_one_open_per_user_per_branch";
CREATE UNIQUE INDEX "CashierShift_one_open_per_branch"
  ON "CashierShift"("branchId")
  WHERE status = 'OPEN';
