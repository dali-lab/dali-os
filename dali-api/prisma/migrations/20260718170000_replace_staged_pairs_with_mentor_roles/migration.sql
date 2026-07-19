-- Mentor/mentee roles on the staffing board are now derived from level with a
-- per-card toggle override (StaffingMentorRole), replacing the manual staged
-- mentee-assignment flow. External-ness is no longer a per-pair flag.

-- AlterTable
ALTER TABLE "MentorshipPair" DROP COLUMN "isExternal";

-- DropTable
DROP TABLE "StagedMentorshipPair";

-- CreateTable
CREATE TABLE "StaffingMentorRole" (
    "id" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isMentor" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "StaffingMentorRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffingMentorRole_staffingCycleId_idx" ON "StaffingMentorRole"("staffingCycleId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingMentorRole_staffingCycleId_userId_key" ON "StaffingMentorRole"("staffingCycleId", "userId");

-- AddForeignKey
ALTER TABLE "StaffingMentorRole" ADD CONSTRAINT "StaffingMentorRole_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingMentorRole" ADD CONSTRAINT "StaffingMentorRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
