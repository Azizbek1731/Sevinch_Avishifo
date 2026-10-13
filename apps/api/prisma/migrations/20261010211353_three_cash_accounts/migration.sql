-- AlterTable
ALTER TABLE "CashierShift" ADD COLUMN     "actualCard" DECIMAL(14,2),
ADD COLUMN     "actualClick" DECIMAL(14,2),
ADD COLUMN     "expectedCard" DECIMAL(14,2),
ADD COLUMN     "expectedClick" DECIMAL(14,2),
ADD COLUMN     "openingCard" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "openingClick" DECIMAL(14,2) NOT NULL DEFAULT 0;
