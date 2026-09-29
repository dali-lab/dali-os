-- CreateTable
CREATE TABLE "DisplayScanSession" (
    "id" TEXT NOT NULL,
    "scheduledMeetingId" TEXT NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisplayScanSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisplayScanSession_scheduledMeetingId_idx" ON "DisplayScanSession"("scheduledMeetingId");

-- AddForeignKey
ALTER TABLE "DisplayScanSession" ADD CONSTRAINT "DisplayScanSession_scheduledMeetingId_fkey" FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

