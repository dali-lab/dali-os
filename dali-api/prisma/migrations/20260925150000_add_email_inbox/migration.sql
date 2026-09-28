-- CreateEnum
CREATE TYPE "MailAccountKind" AS ENUM ('Personal', 'Project', 'Shared');

-- CreateEnum
CREATE TYPE "MailProvider" AS ENUM ('Gmail');

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" TEXT NOT NULL,
    "kind" "MailAccountKind" NOT NULL,
    "provider" "MailProvider" NOT NULL DEFAULT 'Gmail',
    "address" TEXT NOT NULL,
    "displayName" TEXT,
    "scopeKey" TEXT NOT NULL,
    "userId" TEXT,
    "projectId" TEXT,
    "oauthTokens" TEXT,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailDraft" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT,
    "to" TEXT NOT NULL DEFAULT '',
    "cc" TEXT NOT NULL DEFAULT '',
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailComment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE INDEX "MailAccount_projectId_idx" ON "MailAccount"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_scopeKey_address_key" ON "MailAccount"("scopeKey", "address");

-- CreateIndex
CREATE INDEX "MailDraft_accountId_sentAt_idx" ON "MailDraft"("accountId", "sentAt");

-- CreateIndex
CREATE INDEX "MailComment_accountId_threadId_idx" ON "MailComment"("accountId", "threadId");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDraft" ADD CONSTRAINT "MailDraft_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailDraft" ADD CONSTRAINT "MailDraft_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailComment" ADD CONSTRAINT "MailComment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailComment" ADD CONSTRAINT "MailComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

