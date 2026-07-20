-- CreateTable
CREATE TABLE "PortalAccount" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "dob" DATE,
    "gender" "Gender",
    "preferredLocale" "Locale" NOT NULL DEFAULT 'uz',
    "phoneVerifiedAt" TIMESTAMPTZ(6),
    "telegramChatId" TEXT,
    "telegramUsername" TEXT,
    "telegramLinkedAt" TIMESTAMPTZ(6),
    "notifyAppointments" BOOLEAN NOT NULL DEFAULT true,
    "notifyResults" BOOLEAN NOT NULL DEFAULT true,
    "notifyPayments" BOOLEAN NOT NULL DEFAULT true,
    "notifyPromos" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PortalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'telegram_link',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_phone_key" ON "PortalAccount"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "PortalAccount_telegramChatId_key" ON "PortalAccount"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalLinkToken_token_key" ON "PortalLinkToken"("token");

-- CreateIndex
CREATE INDEX "PortalLinkToken_phone_idx" ON "PortalLinkToken"("phone");
