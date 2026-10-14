-- Forms become Drive pages (specs/forms-vs-drive-items-review.md, section 9).
-- Enum values only: Postgres cannot use a new enum value in the transaction
-- that adds it, so the page backfill is the next migration.
ALTER TYPE "PageKind" ADD VALUE 'Form';
ALTER TYPE "LinkAccess" ADD VALUE 'SignedIn';
