-- CreateEnum
CREATE TYPE "PartnerActivityType" AS ENUM ('Created', 'StatusChanged', 'Note', 'EmailSent', 'MeetingScheduled', 'MeetingDebriefed', 'Evaluated');

-- CreateTable
CREATE TABLE "PartnerActivity" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" "PartnerActivityType" NOT NULL,
    "body" TEXT,
    "metadata" JSONB,

    CONSTRAINT "PartnerActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerActivity_applicationId_createdAt_idx" ON "PartnerActivity"("applicationId", "createdAt");

-- AddForeignKey
ALTER TABLE "PartnerActivity" ADD CONSTRAINT "PartnerActivity_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "PartnerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
