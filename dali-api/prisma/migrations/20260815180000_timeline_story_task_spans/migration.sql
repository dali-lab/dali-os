-- AlterTable
ALTER TABLE "UserStory" ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "endsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "startsAt" TIMESTAMP(3),
ADD COLUMN     "storyId" TEXT;

-- CreateTable
CREATE TABLE "UserStoryDependency" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "dependsOnStoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStoryDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserStoryDependency_dependsOnStoryId_idx" ON "UserStoryDependency"("dependsOnStoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserStoryDependency_storyId_dependsOnStoryId_key" ON "UserStoryDependency"("storyId", "dependsOnStoryId");

-- CreateIndex
CREATE INDEX "Task_storyId_idx" ON "Task"("storyId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "UserStory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoryDependency" ADD CONSTRAINT "UserStoryDependency_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "UserStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStoryDependency" ADD CONSTRAINT "UserStoryDependency_dependsOnStoryId_fkey" FOREIGN KEY ("dependsOnStoryId") REFERENCES "UserStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
