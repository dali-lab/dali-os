-- Education MVP: extend NotificationKind for education events + link
-- EducationSession to ScheduledMeeting for lazy calendar push.
-- Both changes are purely additive (enum extension; new nullable FK column).

ALTER TYPE "NotificationKind" ADD VALUE 'EducationApplicationDecision';
ALTER TYPE "NotificationKind" ADD VALUE 'EducationAnnouncementPosted';
ALTER TYPE "NotificationKind" ADD VALUE 'EducationWaitlistPromoted';
ALTER TYPE "NotificationKind" ADD VALUE 'EducationSessionInvite';

ALTER TABLE "EducationSession" ADD COLUMN "scheduledMeetingId" TEXT;

ALTER TABLE "EducationSession"
  ADD CONSTRAINT "EducationSession_scheduledMeetingId_fkey"
  FOREIGN KEY ("scheduledMeetingId") REFERENCES "ScheduledMeeting"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
