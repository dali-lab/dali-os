-- AlterTable
ALTER TABLE "User" ADD COLUMN "dartmouthAffiliation" TEXT;
ALTER TABLE "User" ADD COLUMN "dartmouthIsAlum" BOOLEAN;
ALTER TABLE "User" ADD COLUMN "dartmouthIsStudent" BOOLEAN;
ALTER TABLE "User" ADD COLUMN "dartmouthPeopleSyncedAt" TIMESTAMP(3);
