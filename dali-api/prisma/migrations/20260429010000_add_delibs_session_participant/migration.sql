-- CreateEnum
CREATE TYPE "DelibsParticipantRole" AS ENUM ('HiringLead', 'DomainLead', 'Reviewer');

-- CreateTable
CREATE TABLE "DelibsSessionParticipant" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delibsSessionId" TEXT NOT NULL,
    "daliMemberId" TEXT NOT NULL,
    "role" "DelibsParticipantRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "DelibsSessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DelibsSessionParticipant_delibsSessionId_idx" ON "DelibsSessionParticipant"("delibsSessionId");

-- CreateIndex
CREATE INDEX "DelibsSessionParticipant_delibsSessionId_daliMemberId_leftA_idx" ON "DelibsSessionParticipant"("delibsSessionId", "daliMemberId", "leftAt");

-- AddForeignKey
ALTER TABLE "DelibsSessionParticipant" ADD CONSTRAINT "DelibsSessionParticipant_delibsSessionId_fkey" FOREIGN KEY ("delibsSessionId") REFERENCES "DelibsSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelibsSessionParticipant" ADD CONSTRAINT "DelibsSessionParticipant_daliMemberId_fkey" FOREIGN KEY ("daliMemberId") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
