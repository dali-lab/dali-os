-- Project term model: replace the single firstTerm + termCount "consecutive
-- run" with an explicit, editable ProjectTerm set. termCount is retained as
-- the *expected* span length; the start term becomes the earliest ProjectTerm.
--
-- DATA-LOSING: this drops Project.firstTermId. The backfill below preserves
-- the existing planned span by materializing it into ProjectTerm rows BEFORE
-- the column is dropped. Ordering matters: create -> backfill -> drop.

-- CreateTable
CREATE TABLE "ProjectTerm" (
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTerm_pkey" PRIMARY KEY ("projectId","termId")
);

-- CreateIndex
CREATE INDEX "ProjectTerm_termId_idx" ON "ProjectTerm"("termId");

-- AddForeignKey
ALTER TABLE "ProjectTerm" ADD CONSTRAINT "ProjectTerm_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTerm" ADD CONSTRAINT "ProjectTerm_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: expand each project's (firstTerm, termCount) into explicit
-- ProjectTerm rows. Mirrors the app's old planned-term computation: the
-- termCount chronologically-earliest terms whose sortKey is >= the project's
-- firstTerm.sortKey. Projects with a NULL firstTermId contribute no rows
-- (they had no resolvable span and the UI already treated them as unset).
INSERT INTO "ProjectTerm" ("projectId", "termId", "createdAt")
SELECT p."id", t."id", CURRENT_TIMESTAMP
FROM "Project" p
JOIN "Term" ft ON ft."id" = p."firstTermId"
JOIN LATERAL (
    SELECT t2."id"
    FROM "Term" t2
    WHERE t2."sortKey" >= ft."sortKey"
    ORDER BY t2."sortKey" ASC
    LIMIT GREATEST(p."termCount", 1)
) t ON TRUE
WHERE p."firstTermId" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "Project" DROP CONSTRAINT "Project_firstTermId_fkey";

-- DropColumn (data-losing — preserved above as ProjectTerm rows)
ALTER TABLE "Project" DROP COLUMN "firstTermId";
