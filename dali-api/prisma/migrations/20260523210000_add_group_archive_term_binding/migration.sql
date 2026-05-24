-- Static user groups can now be archived. `archivedAt` records an explicit
-- manual archive; `boundTermIds` scopes a group to one or more terms so it can
-- auto-archive (derived at read time) once the latest bound term has ended.
-- System (Dynamic) groups leave both at their defaults.

-- AlterTable
ALTER TABLE "GroupDefinition" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "boundTermIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "GroupDefinition_archivedAt_idx" ON "GroupDefinition"("archivedAt");
