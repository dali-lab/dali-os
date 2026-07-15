-- CreateTable
CREATE TABLE "ScheduledAnnouncement" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "kind" "NotificationKind" NOT NULL DEFAULT 'General',
    "isTodo" BOOLEAN NOT NULL DEFAULT false,
    "dueAt" TIMESTAMP(3),
    "formId" TEXT,
    "allMembers" BOOLEAN NOT NULL DEFAULT false,
    "groupIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sendAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentCount" INTEGER,
    "lastError" TEXT,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScheduledAnnouncement_sentAt_sendAt_idx" ON "ScheduledAnnouncement"("sentAt", "sendAt");

-- AddForeignKey
ALTER TABLE "ScheduledAnnouncement" ADD CONSTRAINT "ScheduledAnnouncement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

