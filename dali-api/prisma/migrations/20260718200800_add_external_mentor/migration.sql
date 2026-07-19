-- CreateTable
CREATE TABLE "ExternalMentor" (
    "id" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ExternalMentor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalMentor_staffingCycleId_projectId_idx" ON "ExternalMentor"("staffingCycleId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalMentor_staffingCycleId_projectId_userId_domainId_key" ON "ExternalMentor"("staffingCycleId", "projectId", "userId", "domainId");

-- AddForeignKey
ALTER TABLE "ExternalMentor" ADD CONSTRAINT "ExternalMentor_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMentor" ADD CONSTRAINT "ExternalMentor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMentor" ADD CONSTRAINT "ExternalMentor_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalMentor" ADD CONSTRAINT "ExternalMentor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
