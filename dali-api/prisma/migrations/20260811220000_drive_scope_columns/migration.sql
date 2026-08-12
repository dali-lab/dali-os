-- Drive consolidation Wave 2: scope columns on Page and ScopeKind enum.
-- All additive and nullable — no existing rows affected, no backfill required.
-- Null scopeKind means "inherit ancestor scope" (or fall back to workspaceType
-- logic if no ancestor has a scope set). Passes migration-check: no drops, no
-- NOT NULL without a default on populated columns.

-- CreateEnum
CREATE TYPE "ScopeKind" AS ENUM ('Private', 'Lab', 'Group');

-- AlterTable
ALTER TABLE "Page"
  ADD COLUMN "scopeKind"       "ScopeKind",
  ADD COLUMN "scopeGroupId"    TEXT,
  ADD COLUMN "scopePermission" "SharePermission";
