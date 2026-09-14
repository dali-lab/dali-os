-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('Draft', 'Published', 'Archived');

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "termId" TEXT,
    "name" TEXT NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'Draft',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "audienceEveryone" BOOLEAN NOT NULL DEFAULT false,
    "audienceRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "assignedGroupId" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityParticipant" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "ActivityParticipant_pkey" PRIMARY KEY ("activityId","userId")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT NOT NULL DEFAULT '',
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Activity_status_startsAt_endsAt_idx" ON "Activity"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Activity_termId_kind_idx" ON "Activity"("termId", "kind");

-- CreateIndex
CREATE INDEX "ActivityParticipant_userId_idx" ON "ActivityParticipant"("userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_activityId_userId_idx" ON "ActivityEvent"("activityId", "userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_activityId_type_idx" ON "ActivityEvent"("activityId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEvent_activityId_userId_type_refId_key" ON "ActivityEvent"("activityId", "userId", "type", "refId");

-- AddForeignKey
ALTER TABLE "ActivityParticipant" ADD CONSTRAINT "ActivityParticipant_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
