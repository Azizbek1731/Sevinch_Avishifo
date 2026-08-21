-- The auto-close in the previous migration kept the busiest shift and closed
-- the rest — but left the losers' opening floats and any linked money rows
-- attached to CLOSED shifts nobody ever counted. That money would then be
-- outside every reconciliation, permanently: the surviving register's close
-- would show a shortfall or an overage exactly equal to a float that is
-- physically in the same box.
--
-- On today's production rows every auto-closed shift is empty (0 float,
-- 0 linked rows), so this is a no-op there — it exists so the migration pair
-- is correct on ANY database, not just the one we checked.

CREATE TEMP TABLE _folded AS
SELECT l.id  AS loser_id,
       s.id  AS survivor_id,
       l."openingCash"     AS cash,
       l."openingTransfer" AS transfer
FROM "CashierShift" l
JOIN "CashierShift" s
  ON s."branchId" = l."branchId" AND s.status = 'OPEN'
WHERE l.status = 'CLOSED'
  AND l.note LIKE '%[Avtomatik yopildi%';

UPDATE "Payment" p SET "shiftId" = f.survivor_id FROM _folded f WHERE p."shiftId" = f.loser_id;
UPDATE "Refund"  r SET "shiftId" = f.survivor_id FROM _folded f WHERE r."shiftId" = f.loser_id;
UPDATE "Expense" e SET "shiftId" = f.survivor_id FROM _folded f WHERE e."shiftId" = f.loser_id;
UPDATE "PatientBalanceTransaction" t SET "shiftId" = f.survivor_id FROM _folded f WHERE t."shiftId" = f.loser_id;

UPDATE "CashierShift" s
SET "openingCash"     = s."openingCash"     + agg.cash,
    "openingTransfer" = s."openingTransfer" + agg.transfer
FROM (SELECT survivor_id, SUM(cash) cash, SUM(transfer) transfer
      FROM _folded GROUP BY survivor_id) agg
WHERE s.id = agg.survivor_id AND (agg.cash <> 0 OR agg.transfer <> 0);

UPDATE "CashierShift" l
SET "openingCash" = 0, "openingTransfer" = 0,
    note = l.note || ' [qoldiq va yozuvlar ochiq kassaga o''tkazildi]'
FROM _folded f
WHERE l.id = f.loser_id AND (f.cash <> 0 OR f.transfer <> 0);

DROP TABLE _folded;
