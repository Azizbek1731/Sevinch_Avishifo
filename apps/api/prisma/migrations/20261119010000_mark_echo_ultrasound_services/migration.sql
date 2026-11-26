-- EXO catalogues are named with EXO / Echo / Эхо; mark their services so
-- ambulatory shares and doctor reports can split UZI from EXO.
UPDATE "Service" AS s
SET "isEcho" = true
FROM "ServiceCategory" AS sc
WHERE s."categoryId" = sc.id
  AND sc.kind = 'ULTRASOUND'
  AND (
    sc.name ILIKE '%exo%'
    OR sc.name ILIKE '%echo%'
    OR sc.name ILIKE '%эхо%'
  );
