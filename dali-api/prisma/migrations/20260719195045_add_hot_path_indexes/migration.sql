-- CreateIndex
CREATE INDEX "ApplicationStatusUpdate_applicationId_createdAt_idx" ON "ApplicationStatusUpdate"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "Application_applicationCycleId_idx" ON "Application"("applicationCycleId");

-- CreateIndex
CREATE INDEX "DomainApplication_applicationId_idx" ON "DomainApplication"("applicationId");

-- CreateIndex
CREATE INDEX "DomainApplication_domainId_idx" ON "DomainApplication"("domainId");

-- CreateIndex
CREATE INDEX "DomainApplication_challengeVersionId_idx" ON "DomainApplication"("challengeVersionId");

-- CreateIndex
CREATE INDEX "ApplicationCycleStatusUpdate_newStatus_createdAt_idx" ON "ApplicationCycleStatusUpdate"("newStatus", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationCycleStatusUpdate_applicationCycleId_createdAt_idx" ON "ApplicationCycleStatusUpdate"("applicationCycleId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationReview_domainApplicationId_idx" ON "ApplicationReview"("domainApplicationId");

-- CreateIndex
CREATE INDEX "Epic_projectId_idx" ON "Epic"("projectId");

-- CreateIndex
CREATE INDEX "EducationApplication_offeringId_idx" ON "EducationApplication"("offeringId");

