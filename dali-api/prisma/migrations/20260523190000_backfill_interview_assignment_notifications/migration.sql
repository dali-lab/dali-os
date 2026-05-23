-- One-time backfill: surface already-scheduled interviews to their
-- assigned interviewers. PR #639 made interview assignments fire a
-- linked Notification, but only at creation time — assignments made
-- before that ship had no notification row and stayed invisible in
-- the bell + home tasks banner.
--
-- Insert one Notification per Active assignment on a Scheduled
-- interview, linked via interviewAssignmentId so the new
-- listOpenTasks filter still hides it the moment the assignment
-- moves to Declined/Replaced or the interview leaves Scheduled.
--
-- Guarded by NOT EXISTS on the same assignment id so re-running is
-- a no-op and any notifications already created by the new code
-- (between the deploy of #639 and this backfill) aren't duplicated.

INSERT INTO "Notification" (
  "id",
  "recipientUserId",
  "createdByUserId",
  "kind",
  "title",
  "body",
  "link",
  "dueAt",
  "interviewAssignmentId",
  "createdAt",
  "isTodo"
)
SELECT
  gen_random_uuid()::text,
  ci."userId",
  NULL,
  'General',
  'Interview assigned: ' || TRIM(BOTH ' ' FROM (u."firstName" || ' ' || u."lastName")),
  d."name"
    || ' • '
    || to_char(i."startTime" AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD, FMHH12:MI AM')
    || ' • '
    || CASE i."location"::text
         WHEN 'PodAppa' THEN 'Pod Appa'
         WHEN 'PodMomo' THEN 'Pod Momo'
         WHEN 'Online'  THEN 'Online'
         ELSE i."location"::text
       END,
  '/interviewer/interview/' || i."id",
  i."startTime",
  ia."id",
  NOW(),
  false
FROM "InterviewAssignment" ia
JOIN "Interview"          i  ON i."id"  = ia."interviewId"
JOIN "CycleInterviewer"   ci ON ci."id" = ia."cycleInterviewerId"
JOIN "DomainApplication"  da ON da."id" = i."domainApplicationId"
JOIN "Application"        a  ON a."id"  = da."applicationId"
JOIN "User"               u  ON u."id"  = a."userId"
JOIN "Domain"             d  ON d."id"  = da."domainId"
WHERE ia."status" = 'Active'
  AND i."status" = 'Scheduled'
  AND NOT EXISTS (
    SELECT 1
    FROM "Notification" n
    WHERE n."interviewAssignmentId" = ia."id"
  );
