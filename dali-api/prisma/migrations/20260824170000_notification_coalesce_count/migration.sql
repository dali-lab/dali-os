-- In-app notification merging: burst notifications within an event's coalesce
-- window increment this counter on the existing row instead of writing new
-- rows (see app/lib/notify.server.ts). Constant default → metadata-only add,
-- no table rewrite.
ALTER TABLE "Notification" ADD COLUMN "coalesceCount" INTEGER NOT NULL DEFAULT 1;
