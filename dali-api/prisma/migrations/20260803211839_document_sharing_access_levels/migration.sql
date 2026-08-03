-- CreateEnum
CREATE TYPE "SharePermission" AS ENUM ('View', 'Comment', 'Edit', 'FullAccess');

-- CreateEnum
CREATE TYPE "LinkAccess" AS ENUM ('Restricted', 'SignedIn', 'Public');

-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "linkAccess" "LinkAccess" NOT NULL DEFAULT 'Restricted',
ADD COLUMN     "linkPermission" "SharePermission" NOT NULL DEFAULT 'View';

-- AlterTable
ALTER TABLE "PageShare" ADD COLUMN     "permission" "SharePermission" NOT NULL DEFAULT 'View';
