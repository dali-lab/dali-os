-- AlterTable
ALTER TABLE "User" ADD COLUMN "dartmouthLookupAffiliation" TEXT;
ALTER TABLE "User" ADD COLUMN "dartmouthLookupSyncedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "dartmouthAffiliation" TEXT;
ALTER TABLE "User" ADD COLUMN "dartmouthPeopleSyncedAt" TIMESTAMP(3);
