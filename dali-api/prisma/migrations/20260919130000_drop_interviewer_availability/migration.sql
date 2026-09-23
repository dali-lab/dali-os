-- Interview scheduling now reads each interviewer's availability straight from
-- their DALI OS calendar (working hours + linked calendars), so the separately
-- entered availability blocks are no longer read anywhere.
--
-- DATA-LOSING: drops "InterviewerAvailability" and every saved block. Nothing
-- reads them after this change; interviewers need a linked calendar or working
-- hours in DALI OS to be bookable.

-- DropForeignKey
ALTER TABLE "InterviewerAvailability" DROP CONSTRAINT "InterviewerAvailability_cycleInterviewerId_fkey";

-- DropTable
DROP TABLE "InterviewerAvailability";
