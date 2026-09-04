-- CreateTable
CREATE TABLE "InfraProject" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "flyOrgSlug" TEXT,
    "neonOrgId" TEXT,
    "flyReadTokenEnc" TEXT,
    "flyWriteTokenEnc" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InfraProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfraSnapshot" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "InfraSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfraUsageSample" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "scopeName" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfraUsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InfraProject_key_key" ON "InfraProject"("key");

-- CreateIndex
CREATE INDEX "InfraSnapshot_projectKey_provider_fetchedAt_idx" ON "InfraSnapshot"("projectKey", "provider", "fetchedAt");

-- CreateIndex
CREATE INDEX "InfraUsageSample_projectKey_metric_at_idx" ON "InfraUsageSample"("projectKey", "metric", "at");

-- CreateIndex
CREATE UNIQUE INDEX "InfraUsageSample_provider_scopeType_scopeId_metric_at_key" ON "InfraUsageSample"("provider", "scopeType", "scopeId", "metric", "at");
