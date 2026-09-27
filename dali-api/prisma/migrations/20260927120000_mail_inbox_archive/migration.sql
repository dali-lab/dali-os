-- CreateTable
CREATE TABLE "MailInboxArchive" (
    "accountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailInboxArchive_pkey" PRIMARY KEY ("accountId","userId")
);

-- CreateIndex
CREATE INDEX "MailInboxArchive_userId_idx" ON "MailInboxArchive"("userId");

-- AddForeignKey
ALTER TABLE "MailInboxArchive" ADD CONSTRAINT "MailInboxArchive_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailInboxArchive" ADD CONSTRAINT "MailInboxArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

