-- Phase 1 of task deadline reminders (see TASK_REMINDERS_PLAN.md).
-- Adds optional Task.dueAt (deadline) and User.slackUserId (DM target).
-- Both are nullable; no backfill. Reminders + Slack lookup arrive in
-- follow-up migrations and don't depend on data being present here.

ALTER TABLE "Task" ADD COLUMN "dueAt" TIMESTAMP(3);

ALTER TABLE "User" ADD COLUMN "slackUserId" TEXT;

-- Unique so a stale Slack lookup that returns a duplicate id fails loudly
-- instead of silently re-mapping a user.
CREATE UNIQUE INDEX "User_slackUserId_key" ON "User"("slackUserId");
