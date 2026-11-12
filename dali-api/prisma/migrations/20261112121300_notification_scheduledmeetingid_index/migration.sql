-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Notification_scheduledMeetingId_idx" ON "Notification"("scheduledMeetingId");
