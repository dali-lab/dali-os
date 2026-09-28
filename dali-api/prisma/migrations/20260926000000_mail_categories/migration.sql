-- CreateTable
CREATE TABLE "MailCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "audienceUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audienceGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailCategoryAccount" (
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "MailCategoryAccount_pkey" PRIMARY KEY ("categoryId","accountId")
);

-- CreateTable
CREATE TABLE "MailSubscription" (
    "categoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailSubscription_pkey" PRIMARY KEY ("categoryId","userId")
);

-- CreateTable
CREATE TABLE "MailAccountConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oauthTokens" TEXT NOT NULL,
    "syncError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAccountConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailCategoryAccount_accountId_idx" ON "MailCategoryAccount"("accountId");

-- CreateIndex
CREATE INDEX "MailSubscription_userId_idx" ON "MailSubscription"("userId");

-- CreateIndex
CREATE INDEX "MailAccountConnection_userId_idx" ON "MailAccountConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccountConnection_accountId_userId_key" ON "MailAccountConnection"("accountId", "userId");

-- AddForeignKey
ALTER TABLE "MailCategoryAccount" ADD CONSTRAINT "MailCategoryAccount_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MailCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailCategoryAccount" ADD CONSTRAINT "MailCategoryAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSubscription" ADD CONSTRAINT "MailSubscription_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MailCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailSubscription" ADD CONSTRAINT "MailSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccountConnection" ADD CONSTRAINT "MailAccountConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccountConnection" ADD CONSTRAINT "MailAccountConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
