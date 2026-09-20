-- Replace ApplicationCycle.cycleType (Standard | Fellowship | Core) with an
-- `applicants` setting plus per-cycle stage toggles, so any cycle can choose
-- whether it has challenges, an initial delibs round, and interviews.
--
-- DATA-LOSING: drops "cycleType" and its enum. Every value is carried into the
-- new columns first, so each existing cycle keeps its current behavior:
--   Standard   → Students,   challenges on,  initial delibs on,  interviews on
--   Fellowship → Interns,    challenges off, initial delibs off, interviews off
--   Core       → LabMembers, challenges off, initial delibs on,  interviews off
-- Fellowship and Core cycles never honored anonymizeReview (blinding was
-- Standard-only); it is cleared on them so the now-general toggle keeps them
-- unblinded.

-- CreateEnum
CREATE TYPE "CycleApplicants" AS ENUM ('Students', 'Interns', 'LabMembers');

-- AlterTable
ALTER TABLE "ApplicationCycle"
ADD COLUMN     "applicants" "CycleApplicants" NOT NULL DEFAULT 'Students',
ADD COLUMN     "hasChallenges" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hasInitialDelibs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hasInterviews" BOOLEAN NOT NULL DEFAULT true;

-- Backfill from the old discriminator
UPDATE "ApplicationCycle"
SET "applicants" = 'Interns',
    "hasChallenges" = false,
    "hasInitialDelibs" = false,
    "hasInterviews" = false,
    "anonymizeReview" = false
WHERE "cycleType" = 'Fellowship';

UPDATE "ApplicationCycle"
SET "applicants" = 'LabMembers',
    "hasChallenges" = false,
    "hasInterviews" = false,
    "anonymizeReview" = false
WHERE "cycleType" = 'Core';

-- Drop the old discriminator
ALTER TABLE "ApplicationCycle" DROP COLUMN "cycleType";

-- DropEnum
DROP TYPE "ApplicationCycleType";
