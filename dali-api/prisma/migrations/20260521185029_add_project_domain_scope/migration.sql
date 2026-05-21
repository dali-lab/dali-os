-- CreateTable
CREATE TABLE "ProjectDomainScope" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDomainScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDomainScope_projectId_idx" ON "ProjectDomainScope"("projectId");

-- CreateIndex
CREATE INDEX "ProjectDomainScope_domainId_idx" ON "ProjectDomainScope"("domainId");

-- CreateIndex
CREATE INDEX "ProjectDomainScope_termId_idx" ON "ProjectDomainScope"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDomainScope_projectId_domainId_termId_key" ON "ProjectDomainScope"("projectId", "domainId", "termId");

-- AddForeignKey
ALTER TABLE "ProjectDomainScope" ADD CONSTRAINT "ProjectDomainScope_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDomainScope" ADD CONSTRAINT "ProjectDomainScope_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDomainScope" ADD CONSTRAINT "ProjectDomainScope_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDomainScope" ADD CONSTRAINT "ProjectDomainScope_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
