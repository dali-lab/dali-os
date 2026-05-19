-- Link a FormSubmission to a staffing cycle + slot, set only when the form
-- was filled through a staffing-cycle slot binding (e.g. "project-bids").
-- Both columns are nullable: every pre-existing FormSubmission (announcements,
-- public forms) predates this and has no cycle context. These rows are left
-- NULL intentionally — there is no reliable cycle to backfill them to, and the
-- form-driven bids interpreter simply ignores NULL-cycle submissions.
-- Additive only (two nullable columns + one index + one ON DELETE SET NULL
-- FK): no table rewrite, no data loss.

-- AlterTable
ALTER TABLE "FormSubmission" ADD COLUMN "staffingCycleId" TEXT;
ALTER TABLE "FormSubmission" ADD COLUMN "slot" TEXT;

-- CreateIndex
CREATE INDEX "FormSubmission_staffingCycleId_slot_idx" ON "FormSubmission"("staffingCycleId", "slot");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
