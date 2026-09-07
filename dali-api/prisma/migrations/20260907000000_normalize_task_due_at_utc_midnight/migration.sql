-- Normalize Task.dueAt to the UTC date-only convention the timeline uses.
--
-- Background: TaskModal used to serialize a picked deadline as *local*
-- end-of-day (endOfDayIso → 23:59:59 in the creator's browser zone). For
-- viewers west of UTC that instant lands on the *next* UTC calendar day, so the
-- timeline (which buckets by UTC day) drew the task's bar a day late. Going
-- forward dueAt is stored as UTC midnight of the due day, matching how epics,
-- stories, sprints, and Task.startsAt are already stored.
--
-- This backfills the legacy rows. Only rows that are NOT already at UTC midnight
-- are touched — MCP-created deadlines (new Date("YYYY-MM-DD")) are already UTC
-- midnight and are left alone. The intended day is recovered by reading each
-- legacy instant in the lab's timezone (America/New_York), which is where the
-- overwhelming majority of tasks were created; the rare task authored in
-- another zone may shift by a day, which is the best that can be recovered from
-- a value that never stored its origin zone.
--
-- Task.startsAt was already stored as UTC midnight, so it is intentionally not
-- touched. Re-running this migration is a no-op (every row is at UTC midnight
-- afterward, so the WHERE clause matches nothing).
UPDATE "Task"
SET "dueAt" = ((("dueAt" AT TIME ZONE 'America/New_York')::date)::timestamp) AT TIME ZONE 'UTC'
WHERE "dueAt" IS NOT NULL
  AND "dueAt" <> (date_trunc('day', "dueAt" AT TIME ZONE 'UTC')) AT TIME ZONE 'UTC';
