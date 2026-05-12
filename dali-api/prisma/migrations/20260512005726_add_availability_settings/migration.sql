-- CreateEnum
CREATE TYPE "WorkLocation" AS ENUM ('InPerson', 'Remote');

-- CreateTable
CREATE TABLE "UserAvailabilitySettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "defaultEventBufferMin" INTEGER NOT NULL DEFAULT 15,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAvailabilitySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkingHoursDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "startMinute" INTEGER NOT NULL DEFAULT 540,
    "endMinute" INTEGER NOT NULL DEFAULT 1020,
    "location" "WorkLocation" NOT NULL DEFAULT 'InPerson',

    CONSTRAINT "WorkingHoursDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "recurrenceUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserAvailabilitySettings_userId_key" ON "UserAvailabilitySettings"("userId");

-- CreateIndex
CREATE INDEX "WorkingHoursDay_userId_idx" ON "WorkingHoursDay"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkingHoursDay_userId_dayOfWeek_key" ON "WorkingHoursDay"("userId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "ManualBlock_userId_startTime_idx" ON "ManualBlock"("userId", "startTime");

-- AddForeignKey
ALTER TABLE "UserAvailabilitySettings" ADD CONSTRAINT "UserAvailabilitySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkingHoursDay" ADD CONSTRAINT "WorkingHoursDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualBlock" ADD CONSTRAINT "ManualBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
