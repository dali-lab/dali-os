-- CreateEnum
CREATE TYPE "EmailTemplateType" AS ENUM (
  'ApplicationReceived',
  'Rejected',
  'RejectedPostInterview',
  'InvitedToInterview',
  'InterviewInviteMentor',
  'Waitlisted',
  'Accepted'
);

-- Drop existing EmailTemplate table (simple key-value overrides → versioned model)
DROP TABLE IF EXISTS "EmailTemplate";

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "EmailTemplateType" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplate_type_createdAt_idx" ON "EmailTemplate"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "DALIMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
