-- CreateEnum
CREATE TYPE "UserStoryStatus" AS ENUM ('Todo', 'InProgress', 'Done');

-- AlterTable
ALTER TABLE "Epic" ADD COLUMN     "description" TEXT;

-- CreateTable
CREATE TABLE "UserStory" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "status" "UserStoryStatus" NOT NULL DEFAULT 'Todo',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserStory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserStory_epicId_idx" ON "UserStory"("epicId");

-- AddForeignKey
ALTER TABLE "UserStory" ADD CONSTRAINT "UserStory_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
