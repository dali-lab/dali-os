-- Crit Wall comments now live in DocComment; the separate table is retired.
-- DropForeignKey
ALTER TABLE "CritComment" DROP CONSTRAINT "CritComment_submissionId_fkey";

-- DropForeignKey
ALTER TABLE "CritComment" DROP CONSTRAINT "CritComment_authorId_fkey";

-- DropForeignKey
ALTER TABLE "CritComment" DROP CONSTRAINT "CritComment_parentId_fkey";

-- DropTable
DROP TABLE "CritComment";
