-- Permanent 4-digit PIN for doctor pay / ambulatory-share screens (replaces Telegram OTP).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "payPin" VARCHAR(4);

UPDATE "User"
SET "payPin" = '7777'
WHERE "role" = 'DOCTOR' AND ("payPin" IS NULL OR "payPin" = '');
