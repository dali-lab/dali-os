-- CreateTable
CREATE TABLE "MeetingShareGrant" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "principalType" "SharePrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "pageShareId" TEXT NOT NULL,
    "createdShare" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingShareGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingShareGrant_pageId_principalType_principalId_idx" ON "MeetingShareGrant"("pageId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "MeetingShareGrant_pageShareId_idx" ON "MeetingShareGrant"("pageShareId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingShareGrant_scheduledMeetingId_pageId_principalType_p_key" ON "MeetingShareGrant"("scheduledMeetingId", "pageId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "MeetingShareGrant" ADD CONSTRAINT "MeetingShareGrant_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingShareGrant" ADD CONSTRAINT "MeetingShareGrant_pageShareId_fkey" FOREIGN KEY ("pageShareId") REFERENCES "PageShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
