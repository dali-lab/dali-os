-- Core milestones: the week-by-week playbook for running a term, keyed by
-- season. Three new tables, nothing existing is touched.

-- CreateTable
CREATE TABLE "CoreMilestone" (
    "id" TEXT NOT NULL,
    "season" "Season" NOT NULL,
    "week" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoreMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoreMilestoneOwner" (
    "milestoneId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CoreMilestoneOwner_pkey" PRIMARY KEY ("milestoneId","userId")
);

-- CreateTable
CREATE TABLE "CoreMilestoneDomain" (
    "milestoneId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,

    CONSTRAINT "CoreMilestoneDomain_pkey" PRIMARY KEY ("milestoneId","domainId")
);

-- CreateIndex
CREATE INDEX "CoreMilestone_season_week_idx" ON "CoreMilestone"("season", "week");

-- CreateIndex
CREATE INDEX "CoreMilestoneOwner_userId_idx" ON "CoreMilestoneOwner"("userId");

-- CreateIndex
CREATE INDEX "CoreMilestoneDomain_domainId_idx" ON "CoreMilestoneDomain"("domainId");

-- AddForeignKey
ALTER TABLE "CoreMilestoneOwner" ADD CONSTRAINT "CoreMilestoneOwner_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "CoreMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreMilestoneOwner" ADD CONSTRAINT "CoreMilestoneOwner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreMilestoneDomain" ADD CONSTRAINT "CoreMilestoneDomain_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "CoreMilestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoreMilestoneDomain" ADD CONSTRAINT "CoreMilestoneDomain_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
