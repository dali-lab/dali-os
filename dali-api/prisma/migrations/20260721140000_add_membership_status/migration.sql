-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('Active', 'Alumni');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "membershipStatus" "MembershipStatus" NOT NULL DEFAULT 'Active',
ADD COLUMN     "membershipStatusOverride" "MembershipStatus",
ADD COLUMN     "membershipStatusComputedAt" TIMESTAMP(3),
ADD COLUMN     "dartmouthAffiliation" TEXT,
ADD COLUMN     "dartmouthIsAlum" BOOLEAN,
ADD COLUMN     "dartmouthIsStudent" BOOLEAN,
ADD COLUMN     "dartmouthPeopleSyncedAt" TIMESTAMP(3);
