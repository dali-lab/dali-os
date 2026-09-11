-- Broaden InfraRequest.kind: enum -> free-form String (registry-backed).
-- Existing enum values are valid strings, so the cast is lossless.

-- AlterTable
ALTER TABLE "InfraRequest" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;

-- DropEnum
DROP TYPE "InfraRequestKind";
