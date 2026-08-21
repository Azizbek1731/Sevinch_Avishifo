-- Ambulator vs statsionar, chosen when the patient is registered.

-- CreateEnum
CREATE TYPE "CareType" AS ENUM ('AMBULATORY', 'INPATIENT');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "careType" "CareType" NOT NULL DEFAULT 'AMBULATORY';

