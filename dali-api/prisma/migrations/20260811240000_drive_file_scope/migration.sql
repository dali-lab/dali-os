-- Migration: drive_file_scope
-- Generalizes ProjectFile so files can live in any drive scope (Lab or
-- Project), not just projects. All changes are additive/nullable — no data
-- loss, no backfill required, passes migration-check safety analysis.

-- 1. Make projectId nullable so Lab-scoped files can have no project.
ALTER TABLE "ProjectFile" ALTER COLUMN "projectId" DROP NOT NULL;

-- 2. Add workspace-scope columns, mirroring the Page.workspaceType /
--    Page.workspaceId polymorphic pattern. Both nullable so existing
--    project-owned rows need no change.
ALTER TABLE "ProjectFile" ADD COLUMN "workspaceType" "WorkspaceType";
ALTER TABLE "ProjectFile" ADD COLUMN "workspaceId"   TEXT;

-- 3. Index for Lab-scope file queries (workspaceType = 'Lab', archivedAt IS NULL)
--    and for any future group-scoped file queries.
CREATE INDEX "ProjectFile_workspaceType_workspaceId_archivedAt_idx"
  ON "ProjectFile" ("workspaceType", "workspaceId", "archivedAt");
