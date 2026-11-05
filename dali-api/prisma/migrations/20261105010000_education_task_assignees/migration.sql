ALTER TABLE "EducationTask" ADD COLUMN "assigneeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "EducationTask" SET "assigneeIds" = ARRAY["assigneeId"] WHERE "assigneeId" IS NOT NULL;
UPDATE "EducationTask" SET "assigneeIds" = ARRAY[]::TEXT[] WHERE "assigneeId" IS NULL;

ALTER TABLE "EducationTask" ALTER COLUMN "assigneeIds" SET NOT NULL;

ALTER TABLE "EducationTask" DROP CONSTRAINT "EducationTask_assigneeId_fkey";
DROP INDEX "EducationTask_assigneeId_idx";
ALTER TABLE "EducationTask" DROP COLUMN "assigneeId";
