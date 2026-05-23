-- Link a Notification optionally to the InterviewAssignment it was fired
-- for. Lets listOpenTasks filter out notifications whose assignment is no
-- longer Active (Declined / Replaced) or whose interview is no longer
-- Scheduled (Cancelled / Completed). The notification then disappears
-- from the bell + home tasks banner without any extra fan-out writes the
-- moment the underlying assignment state changes.
--
-- Nullable on purpose: notifications unrelated to interview assignments
-- (MeetingInvite, SystemAnnouncement, General, etc.) leave it null.
-- ON DELETE SET NULL so deleting an assignment doesn't cascade-delete
-- the user's notification history.

ALTER TABLE "Notification" ADD COLUMN "interviewAssignmentId" TEXT;

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_interviewAssignmentId_fkey"
  FOREIGN KEY ("interviewAssignmentId") REFERENCES "InterviewAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Notification_interviewAssignmentId_idx" ON "Notification"("interviewAssignmentId");
