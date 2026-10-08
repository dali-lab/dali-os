-- Profile: a "Based in" location (geocoded for the Connect map) and a Work
-- experience list. Additive only.

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OnSite', 'Hybrid', 'Remote');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentLocation" TEXT,
ADD COLUMN     "currentLocationLat" DOUBLE PRECISION,
ADD COLUMN     "currentLocationLng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "WorkExperience" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "workMode" "WorkMode",
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),

    CONSTRAINT "WorkExperience_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkExperience_userId_startDate_idx" ON "WorkExperience"("userId", "startDate");

-- AddForeignKey
ALTER TABLE "WorkExperience" ADD CONSTRAINT "WorkExperience_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
