-- CreateEnum
CREATE TYPE "MaintenancePlan" AS ENUM ('Hosting', 'Mild', 'Medium');

-- AlterTable
ALTER TABLE "PartnerCrmSettings" ADD COLUMN     "maintenanceHostingCents" INTEGER,
ADD COLUMN     "maintenanceMediumCents" INTEGER,
ADD COLUMN     "maintenanceMildCents" INTEGER;

-- CreateTable
CREATE TABLE "ProjectMaintenance" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "plan" "MaintenancePlan" NOT NULL,
    "feeCents" INTEGER,
    "startTermId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedById" TEXT,
    "endedAt" TIMESTAMP(3),
    "endedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectMaintenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectMaintenance_projectId_endedAt_idx" ON "ProjectMaintenance"("projectId", "endedAt");

-- AddForeignKey
ALTER TABLE "ProjectMaintenance" ADD CONSTRAINT "ProjectMaintenance_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMaintenance" ADD CONSTRAINT "ProjectMaintenance_startTermId_fkey" FOREIGN KEY ("startTermId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;
