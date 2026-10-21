-- Interview rounds: a cycle's timeline can hold more than one Interviews
-- block. Settings, interviewer rosters, interviews and invites each name the
-- round they belong to. Existing rows are the first round, "interviews".

-- AlterTable
ALTER TABLE "InterviewConfig" ADD COLUMN "interviewRoundId" TEXT NOT NULL DEFAULT 'interviews';
ALTER TABLE "CycleInterviewer" ADD COLUMN "interviewRoundId" TEXT NOT NULL DEFAULT 'interviews';
ALTER TABLE "Interview" ADD COLUMN "interviewRoundId" TEXT NOT NULL DEFAULT 'interviews';
ALTER TABLE "Decision" ADD COLUMN "interviewRoundId" TEXT;

-- Backfill: every existing invite is for the first round.
UPDATE "Decision" SET "interviewRoundId" = 'interviews' WHERE "type" = 'InvitedToInterview';

-- One settings row per round instead of per cycle.
DROP INDEX "InterviewConfig_applicationCycleId_key";
CREATE UNIQUE INDEX "InterviewConfig_applicationCycleId_interviewRoundId_key" ON "InterviewConfig"("applicationCycleId", "interviewRoundId");

-- One roster entry per member, domain and round.
DROP INDEX "CycleInterviewer_userId_applicationCycleId_domainId_key";
CREATE UNIQUE INDEX "CycleInterviewer_userId_applicationCycleId_domainId_intervi_key" ON "CycleInterviewer"("userId", "applicationCycleId", "domainId", "interviewRoundId");
