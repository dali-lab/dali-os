-- Data-losing: drops the ProcessFolderBinding table. Filing reads receiver
-- columns on Page (folderType / processType / processId) and no longer
-- consults bindings.

-- DropForeignKey
ALTER TABLE "ProcessFolderBinding" DROP CONSTRAINT "ProcessFolderBinding_folderPageId_fkey";

-- DropTable
DROP TABLE "ProcessFolderBinding";
