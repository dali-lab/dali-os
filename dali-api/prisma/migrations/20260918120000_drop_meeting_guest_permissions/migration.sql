-- Retire per-meeting guest permissions. Editing, inviting, and seeing the guest
-- list go back to the fixed rule the columns' defaults already encoded: the
-- organizer and Core edit/invite; every invitee sees the guest list.
--
-- Data loss: the three flags are dropped. Any meeting where an organizer had
-- turned one away from its default loses that setting and reverts to the rule
-- above.

-- AlterTable
ALTER TABLE "ScheduledMeeting" DROP COLUMN "guestsCanInviteOthers",
DROP COLUMN "guestsCanModify",
DROP COLUMN "guestsCanSeeGuestList";
