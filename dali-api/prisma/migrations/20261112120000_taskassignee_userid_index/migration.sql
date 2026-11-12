-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");
