-- What the stay still owed when it was closed. Nullable: rows written before
-- this column existed genuinely have no answer, and 0.00 would claim they were
-- checked and found settled.
ALTER TABLE "Admission" ADD COLUMN "debtAtDischarge" DECIMAL(14,2);
