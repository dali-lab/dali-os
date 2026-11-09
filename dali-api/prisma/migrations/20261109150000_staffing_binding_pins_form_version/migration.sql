-- AlterTable
ALTER TABLE "StaffingCycleFormBinding" ADD COLUMN     "formVersionId" TEXT;

-- CreateIndex
CREATE INDEX "StaffingCycleFormBinding_formVersionId_idx" ON "StaffingCycleFormBinding"("formVersionId");

-- AddForeignKey
ALTER TABLE "StaffingCycleFormBinding" ADD CONSTRAINT "StaffingCycleFormBinding_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pin existing bindings to the version their round actually used: first the
-- newest version among the submissions recorded under the binding's cycle and
-- slot, else the newest version that existed when the manager last touched
-- the binding, else the form's latest. Pinning everything to the current
-- latest would make a binding from the v1 era conflict with binding v2 to a
-- new cycle, which is the case this column exists to allow.
UPDATE "StaffingCycleFormBinding" b
SET "formVersionId" = COALESCE(
  (
    SELECT v."id" FROM "FormVersion" v
    JOIN "FormSubmission" s ON s."formVersionId" = v."id"
    WHERE s."staffingCycleId" = b."staffingCycleId"
      AND s."slot" = b."slot"
      AND s."formId" = b."formId"
    ORDER BY v."versionNumber" DESC
    LIMIT 1
  ),
  (
    SELECT v."id" FROM "FormVersion" v
    WHERE v."formId" = b."formId" AND v."createdAt" <= b."updatedAt"
    ORDER BY v."versionNumber" DESC
    LIMIT 1
  ),
  (
    SELECT v."id" FROM "FormVersion" v
    WHERE v."formId" = b."formId"
    ORDER BY v."versionNumber" DESC
    LIMIT 1
  )
);
