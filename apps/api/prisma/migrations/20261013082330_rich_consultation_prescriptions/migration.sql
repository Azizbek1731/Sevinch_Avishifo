-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "combineWithPrevious" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dripRate" TEXT,
ADD COLUMN     "durationText" TEXT,
ADD COLUMN     "form" TEXT,
ADD COLUMN     "quantity" TEXT,
ADD COLUMN     "route" TEXT,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "strength" TEXT;

-- AlterTable
ALTER TABLE "Visit" ADD COLUMN     "physiotherapy" TEXT,
ADD COLUMN     "prescriptionRevision" INTEGER NOT NULL DEFAULT 0;
