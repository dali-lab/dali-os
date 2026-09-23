-- AlterEnum
--
-- Postgres 16 allows ALTER TYPE ... ADD VALUE inside a transaction; the new
-- value just can't be *used* in that same transaction. This migration only
-- adds the value (no row writes it), so it is safe.
ALTER TYPE "PageKind" ADD VALUE 'Whiteboard';
