-- Bound staffing forms (intent-to-work / project-bids / level-up) had no
-- one-submission gate: submitMemberForm did an unconditional create per submit,
-- so a member could re-submit and pile up duplicate FormSubmission rows for the
-- same (user, cycle, slot). Enforce one submission per member per bound slot,
-- and add optional per-binding app-lock config (gateAudience) reusing the
-- signing audience enum + resolvers.
--
-- DATA CHANGE (not reversible): the DELETE below removes duplicate historical
-- bound submissions, keeping the most recent row per (userId, staffingCycleId,
-- slot). Only bound-staffing rows (all three columns set) are touched; ordinary
-- fills (slot/cycle null) and education submissions (cycle null) are untouched.
-- Required so the new unique index can be created without a conflict.

-- Deduplicate existing bound submissions: drop every row that has a newer (or
-- equal-timestamp, higher-id) sibling with the same user+cycle+slot.
DELETE FROM "FormSubmission" a
USING "FormSubmission" b
WHERE a."userId" IS NOT NULL
  AND a."staffingCycleId" IS NOT NULL
  AND a."slot" IS NOT NULL
  AND a."userId" = b."userId"
  AND a."staffingCycleId" = b."staffingCycleId"
  AND a."slot" = b."slot"
  AND (a."createdAt" < b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- AlterTable
ALTER TABLE "StaffingCycleFormBinding" ADD COLUMN     "gateAudience" "SigningAudience",
ADD COLUMN     "gateAudienceGroupId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FormSubmission_userId_staffingCycleId_slot_key" ON "FormSubmission"("userId", "staffingCycleId", "slot");
