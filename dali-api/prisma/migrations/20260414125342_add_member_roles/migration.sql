-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('Admin', 'HiringLead');

-- AlterTable
ALTER TABLE "DALIMember" ADD COLUMN     "roles" "MemberRole"[] DEFAULT ARRAY[]::"MemberRole"[];
