-- Fast search-as-you-type (spec §M3): trigram GIN indexes for patient & directory search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Patient_fullName_trgm_idx"
  ON "Patient" USING GIN ("fullName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Patient_phone_trgm_idx"
  ON "Patient" USING GIN ("phone" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Patient_mrn_trgm_idx"
  ON "Patient" USING GIN ("mrn" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Icd10Code_code_trgm_idx"
  ON "Icd10Code" USING GIN ("code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Icd10Code_nameUz_trgm_idx"
  ON "Icd10Code" USING GIN ("nameUz" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Icd10Code_nameRu_trgm_idx"
  ON "Icd10Code" USING GIN ("nameRu" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "DrugDirectory_name_trgm_idx"
  ON "DrugDirectory" USING GIN ("name" gin_trgm_ops);
