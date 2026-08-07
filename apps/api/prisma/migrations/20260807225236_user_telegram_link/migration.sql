-- Telegram binding for staff and platform super-admins. Patients keep binding
-- through PortalAccount / TelegramLink; those tables cannot represent a User
-- because TelegramLink.patientId is a required FK to Patient.
ALTER TABLE "User" ADD COLUMN "telegramChatId" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramUsername" TEXT;
ALTER TABLE "User" ADD COLUMN "telegramLinkedAt" TIMESTAMPTZ(6);

-- One Telegram chat serves at most one staff identity.
CREATE UNIQUE INDEX "User_telegramChatId_key" ON "User"("telegramChatId");
