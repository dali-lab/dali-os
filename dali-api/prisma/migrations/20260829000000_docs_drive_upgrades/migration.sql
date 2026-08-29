-- docs-drive-upgrades: rich comments, named versions, form soft-delete
-- Additive-only — every column is nullable. Non-data-losing.

-- DocComment: rich comment body (array of inline segments incl. mention chips).
-- Null = legacy/plaintext comment (render `body` verbatim).
ALTER TABLE "DocComment" ADD COLUMN "bodyJson" JSONB;

-- CollabDocumentVersion: user-given name for a pinned/named version. Non-null
-- marks the version as pinned (surfaced distinctly, exempt from auto-pruning).
ALTER TABLE "CollabDocumentVersion" ADD COLUMN "label" TEXT;

-- Form: soft-delete for Drive trash. Non-null = archived (restorable). A
-- permanent delete from Trash removes the row for real.
ALTER TABLE "Form" ADD COLUMN "archivedAt" TIMESTAMP(3);
