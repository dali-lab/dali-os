-- AlterTable
ALTER TABLE "StaffingCycleFormBinding" ADD COLUMN     "formVersionId" TEXT;

-- CreateIndex
CREATE INDEX "StaffingCycleFormBinding_formVersionId_idx" ON "StaffingCycleFormBinding"("formVersionId");

-- AddForeignKey
ALTER TABLE "StaffingCycleFormBinding" ADD CONSTRAINT "StaffingCycleFormBinding_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "FormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Pin existing bindings to their form's current latest version, so a future
-- "Save as version" frees the form for another cycle instead of conflicting.
UPDATE "StaffingCycleFormBinding" b
SET "formVersionId" = (
  SELECT v."id" FROM "FormVersion" v
  WHERE v."formId" = b."formId"
  ORDER BY v."versionNumber" DESC
  LIMIT 1
);
