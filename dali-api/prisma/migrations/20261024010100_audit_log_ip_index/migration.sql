-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_ip_createdAt_idx" ON "AuditLog"("ip", "createdAt");
