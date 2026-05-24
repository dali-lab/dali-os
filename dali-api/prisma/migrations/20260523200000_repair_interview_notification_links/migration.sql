-- Repair interview-assignment notification links written with the wrong
-- path. The helper in #639 and the backfill SELECT in #643 both wrote
-- `link = /interviewer/interview/<id>`, but the registered route is
-- `/hiring/interviewer/interview/<id>`. Without the `/hiring/` prefix
-- the recipient hits a 404 when they open the tile from the bell or
-- the home tasks banner.
--
-- Scoped to interview-assignment notifications via `interviewAssignmentId
-- IS NOT NULL` so unrelated `/interviewer/...` links (none exist today,
-- but the guard keeps it future-proof) are left alone. Idempotent: rows
-- already on the correct path are filtered out by the LIKE pattern.

UPDATE "Notification"
SET "link" = '/hiring' || "link"
WHERE "interviewAssignmentId" IS NOT NULL
  AND "link" LIKE '/interviewer/interview/%';
