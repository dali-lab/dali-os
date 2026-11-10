-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('Standard', 'CoreBoard');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "kind" "ProjectKind" NOT NULL DEFAULT 'Standard';

-- At most one hidden Core board project (partial index; Prisma cannot express it)
CREATE UNIQUE INDEX "Project_one_core_board" ON "Project" ("kind") WHERE "kind" = 'CoreBoard';
