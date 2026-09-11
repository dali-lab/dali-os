-- CreateEnum
CREATE TYPE "InfraRequestKind" AS ENUM ('provision_database', 'scale_compute', 'adjust_limits', 'other');

-- CreateEnum
CREATE TYPE "InfraRequestStatus" AS ENUM ('Pending', 'Fulfilled', 'Rejected');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "flyOrgSlug" TEXT,
ADD COLUMN     "flyReadTokenEnc" TEXT,
ADD COLUMN     "flyWriteTokenEnc" TEXT,
ADD COLUMN     "infraEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "neonOrgId" TEXT;

-- CreateTable
CREATE TABLE "InfraSnapshot" (
    "id" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "InfraSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfraUsageSample" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "scopeName" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfraUsageSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfraRequest" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "projectId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "kind" "InfraRequestKind" NOT NULL,
    "details" TEXT NOT NULL,
    "targetHint" TEXT,
    "status" "InfraRequestStatus" NOT NULL DEFAULT 'Pending',
    "resolutionNote" TEXT,
    "resolvedByUserId" TEXT,

    CONSTRAINT "InfraRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfraSnapshot_projectId_provider_fetchedAt_idx" ON "InfraSnapshot"("projectId", "provider", "fetchedAt");

-- CreateIndex
CREATE INDEX "InfraUsageSample_projectId_metric_at_idx" ON "InfraUsageSample"("projectId", "metric", "at");

-- CreateIndex
CREATE UNIQUE INDEX "InfraUsageSample_provider_scopeType_scopeId_metric_at_key" ON "InfraUsageSample"("provider", "scopeType", "scopeId", "metric", "at");

-- CreateIndex
CREATE INDEX "InfraRequest_projectId_status_idx" ON "InfraRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "InfraRequest_status_createdAt_idx" ON "InfraRequest"("status", "createdAt");
