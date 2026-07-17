-- AlterEnum
ALTER TYPE "EpicStatus" ADD VALUE 'Backlog';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "description" TEXT;
