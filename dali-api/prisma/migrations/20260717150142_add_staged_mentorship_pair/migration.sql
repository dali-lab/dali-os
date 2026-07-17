-- CreateTable
CREATE TABLE "StagedMentorshipPair" (
    "id" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "menteeUserId" TEXT NOT NULL,
    "mentorUserId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "StagedMentorshipPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagedMentorshipPair_staffingCycleId_projectId_idx" ON "StagedMentorshipPair"("staffingCycleId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StagedMentorshipPair_staffingCycleId_menteeUserId_mentorUse_key" ON "StagedMentorshipPair"("staffingCycleId", "menteeUserId", "mentorUserId", "domainId");

-- AddForeignKey
ALTER TABLE "StagedMentorshipPair" ADD CONSTRAINT "StagedMentorshipPair_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMentorshipPair" ADD CONSTRAINT "StagedMentorshipPair_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMentorshipPair" ADD CONSTRAINT "StagedMentorshipPair_menteeUserId_fkey" FOREIGN KEY ("menteeUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMentorshipPair" ADD CONSTRAINT "StagedMentorshipPair_mentorUserId_fkey" FOREIGN KEY ("mentorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedMentorshipPair" ADD CONSTRAINT "StagedMentorshipPair_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
