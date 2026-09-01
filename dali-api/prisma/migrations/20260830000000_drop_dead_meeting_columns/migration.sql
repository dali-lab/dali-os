-- Drop two dead columns on ScheduledMeeting.
--
--   descriptionDocId — never written or read by any meeting code path (a
--                      copy-paste artifact from Epic/EducationOffering, which
--                      keep the field live). Verified empty in prod:
--                      SELECT count(*) FROM "ScheduledMeeting"
--                      WHERE "descriptionDocId" IS NOT NULL;  -> 0
--
--   checkInToken     — generated for SelfCheckIn meetings but never looked up.
--                      The self-check-in route authenticates the caller's own
--                      session and routes by meeting id; it never reads the
--                      token, and no other table references it. Dropping it
--                      discards only unused generated secrets, not user data.
--
-- DATA-LOSING: both columns are dropped. See the PR description.
-- Dropping "checkInToken" also drops its unique index
-- ("ScheduledMeeting_checkInToken_key") automatically.
ALTER TABLE "ScheduledMeeting" DROP COLUMN "descriptionDocId";
ALTER TABLE "ScheduledMeeting" DROP COLUMN "checkInToken";
