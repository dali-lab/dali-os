-- New notification slot fired by the hiring lead's "Resend invite" action on
-- a DomainApplication that has been Released InvitedToInterview but never
-- booked a Scheduled interview. Distinct from the original decision:invite
-- template so leads can phrase the nudge as a reminder rather than a fresh
-- invitation.
ALTER TYPE "NotificationType" ADD VALUE 'InterviewInviteReminder';
