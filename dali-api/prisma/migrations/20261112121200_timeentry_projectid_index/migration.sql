-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TimeEntry_projectId_idx" ON "TimeEntry"("projectId");
