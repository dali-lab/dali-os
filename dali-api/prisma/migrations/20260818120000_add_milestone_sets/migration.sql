-- Milestone sets: versioned, Drive-authored, project-assigned week-by-week
-- timelines. Generalizes the single lab term timeline
-- (TimelineWeek/TimelineMilestone) into reusable sets Core authors in Drive,
-- versions (MilestoneSetVersion, FormVersion-style lock-on-use), and assigns
-- per project each term (ProjectMilestoneAssignment). See specs/milestones.md.
--
-- Purely additive — no existing table is touched. The "Lab default" set is
-- seeded LAZILY server-side (like loadTimeline() seeds the term timeline), not
-- here, because MilestoneSetVersion.createdById is a required FK with no
-- natural system user to attribute in raw SQL.

-- CreateTable
CREATE TABLE "MilestoneSet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "folderPageId" TEXT,
    "isLabWide" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "draftEntries" JSONB,

    CONSTRAINT "MilestoneSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MilestoneSetVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "entries" JSONB NOT NULL,
    "setId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "MilestoneSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestoneAssignment" (
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMilestoneAssignment_pkey" PRIMARY KEY ("projectId","termId")
);

-- CreateIndex
CREATE INDEX "MilestoneSet_folderPageId_idx" ON "MilestoneSet"("folderPageId");

-- CreateIndex
CREATE INDEX "MilestoneSet_createdById_idx" ON "MilestoneSet"("createdById");

-- CreateIndex
CREATE INDEX "MilestoneSetVersion_setId_versionNumber_idx" ON "MilestoneSetVersion"("setId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MilestoneSetVersion_setId_versionNumber_key" ON "MilestoneSetVersion"("setId", "versionNumber");

-- CreateIndex
CREATE INDEX "ProjectMilestoneAssignment_termId_idx" ON "ProjectMilestoneAssignment"("termId");

-- CreateIndex
CREATE INDEX "ProjectMilestoneAssignment_versionId_idx" ON "ProjectMilestoneAssignment"("versionId");

-- AddForeignKey
ALTER TABLE "MilestoneSet" ADD CONSTRAINT "MilestoneSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSetVersion" ADD CONSTRAINT "MilestoneSetVersion_setId_fkey" FOREIGN KEY ("setId") REFERENCES "MilestoneSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MilestoneSetVersion" ADD CONSTRAINT "MilestoneSetVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneAssignment" ADD CONSTRAINT "ProjectMilestoneAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneAssignment" ADD CONSTRAINT "ProjectMilestoneAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestoneAssignment" ADD CONSTRAINT "ProjectMilestoneAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MilestoneSetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

