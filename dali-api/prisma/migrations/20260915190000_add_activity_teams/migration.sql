-- CreateEnum
CREATE TYPE "ActivityScoring" AS ENUM ('Individual', 'Team');

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "scoring" "ActivityScoring" NOT NULL DEFAULT 'Individual',
ADD COLUMN     "teamSize" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "ActivityParticipant" ADD COLUMN     "teamId" TEXT;

-- CreateTable
CREATE TABLE "ActivityTeam" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityTeam_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityTeam_activityId_idx" ON "ActivityTeam"("activityId");

-- CreateIndex
CREATE INDEX "ActivityParticipant_teamId_idx" ON "ActivityParticipant"("teamId");

-- AddForeignKey
ALTER TABLE "ActivityParticipant" ADD CONSTRAINT "ActivityParticipant_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "ActivityTeam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityTeam" ADD CONSTRAINT "ActivityTeam_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

