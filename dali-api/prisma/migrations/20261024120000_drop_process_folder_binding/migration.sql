-- Data-losing: drops ProcessFolderBinding. Filing reads the receiver columns on
-- Page (folderType / processType / processId) and nothing reads this table
-- since #2364.

-- DropForeignKey
ALTER TABLE "ProcessFolderBinding" DROP CONSTRAINT "ProcessFolderBinding_folderPageId_fkey";

-- DropTable
DROP TABLE "ProcessFolderBinding";
