-- CreateTable
CREATE TABLE "PlanningNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "applicationId" TEXT,
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanningNote_projectId_key" ON "PlanningNote"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningNote_applicationId_key" ON "PlanningNote"("applicationId");

-- AddForeignKey
ALTER TABLE "PlanningNote" ADD CONSTRAINT "PlanningNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningNote" ADD CONSTRAINT "PlanningNote_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningNote" ADD CONSTRAINT "PlanningNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
