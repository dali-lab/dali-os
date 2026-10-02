-- Start term, separated from the term a hiring cycle runs in.
--
-- ApplicationCycle.termId has always meant "the term the hiring runs in" (it
-- anchors the phase weeks), but the onboarding board read it as the term the
-- cycle's hires START in. Those coincide for an ordinary cycle and diverge the
-- moment a hire starts in a later term, which the schema had no way to say.
--
-- `startTermIds` is the set of start terms a Students cycle offers, in the
-- order the lead arranged them; `Application.startTermId` is the one the
-- applicant picked (editable by Core afterward). Both additive and empty/null
-- by default, so every existing cycle and application keeps its current
-- behavior and readers fall back to the cycle's own term.

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN "startTermIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "startTermId" TEXT;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_startTermId_fkey" FOREIGN KEY ("startTermId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The board and the picker both filter accepted applications by start term.
CREATE INDEX "Application_startTermId_idx" ON "Application"("startTermId");
