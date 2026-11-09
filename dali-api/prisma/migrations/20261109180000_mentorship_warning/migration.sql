-- CreateTable
CREATE TABLE "MentorshipWarning" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "occurredOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MentorshipWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MentorshipWarning_memberId_idx" ON "MentorshipWarning"("memberId");

-- CreateIndex
CREATE INDEX "MentorshipWarning_status_occurredOn_idx" ON "MentorshipWarning"("status", "occurredOn");

-- AddForeignKey
ALTER TABLE "MentorshipWarning" ADD CONSTRAINT "MentorshipWarning_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipWarning" ADD CONSTRAINT "MentorshipWarning_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
