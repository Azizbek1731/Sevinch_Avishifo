-- DropIndex
DROP INDEX "DrugDirectory_name_trgm_idx";

-- DropIndex
DROP INDEX "Icd10Code_code_trgm_idx";

-- DropIndex
DROP INDEX "Icd10Code_nameRu_trgm_idx";

-- DropIndex
DROP INDEX "Icd10Code_nameUz_trgm_idx";

-- DropIndex
DROP INDEX "Patient_fullName_trgm_idx";

-- DropIndex
DROP INDEX "Patient_mrn_trgm_idx";

-- DropIndex
DROP INDEX "Patient_phone_trgm_idx";

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN     "defaultRoomId" TEXT;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_defaultRoomId_fkey" FOREIGN KEY ("defaultRoomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
