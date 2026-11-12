-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ScheduledMeeting_organizerId_idx" ON "ScheduledMeeting"("organizerId");
