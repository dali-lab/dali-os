-- CreateTable
CREATE TABLE "TaskStatusChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fromStatus" "TaskStatus" NOT NULL,
    "toStatus" "TaskStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStatusChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskStatusChange_changedAt_idx" ON "TaskStatusChange"("changedAt");

-- CreateIndex
CREATE INDEX "TaskStatusChange_taskId_changedAt_idx" ON "TaskStatusChange"("taskId", "changedAt");

-- Record status changes in the database itself so every writer (routes, MCP
-- tools, jobs, GitHub sync, scripts) is covered. clock_timestamp() rather than
-- now() so a long transaction stamps when the move happened, in UTC to match
-- how Prisma stores DateTime.
CREATE FUNCTION "record_task_status_change"() RETURNS trigger AS $$
BEGIN
  INSERT INTO "TaskStatusChange" ("id", "taskId", "projectId", "fromStatus", "toStatus", "changedAt")
  VALUES (gen_random_uuid()::text, NEW."id", NEW."projectId", OLD."status", NEW."status", clock_timestamp() AT TIME ZONE 'UTC');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Task_status_change"
AFTER UPDATE OF "status" ON "Task"
FOR EACH ROW
WHEN (OLD."status" IS DISTINCT FROM NEW."status")
EXECUTE FUNCTION "record_task_status_change"();
