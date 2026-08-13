-- Drive consolidation Wave 3 (partial): folderPageId placement columns on
-- ProjectFile and Form, enabling both item types to be placed inside the
-- unified folder tree (Page kind=Folder) that already exists for documents.
--
-- All additive and nullable — no existing rows are affected, no backfill is
-- required. Null folderPageId means "unplaced" (item renders at its default
-- legacy location: project files list or FormsBrowser).
--
-- The FK is intentionally loose (no DB-level REFERENCES constraint) to match
-- the existing Page.workspaceId / Page.scopeGroupId / ProjectFile convention
-- in this schema. The app enforces referential correctness at write time.
--
-- Passes migration-check: no drops, no NOT NULL without a default on populated
-- columns, no data loss. Hand-authored because no DB connection is available
-- in the CI worktree; run `prisma migrate resolve --applied` after validating
-- against a real shadow DB.

-- AlterTable: ProjectFile — add tree-placement column + index
ALTER TABLE "ProjectFile" ADD COLUMN "folderPageId" TEXT;
CREATE INDEX "ProjectFile_folderPageId_idx" ON "ProjectFile"("folderPageId");

-- AlterTable: Form — add tree-placement column + index
ALTER TABLE "Form" ADD COLUMN "folderPageId" TEXT;
CREATE INDEX "Form_folderPageId_idx" ON "Form"("folderPageId");
