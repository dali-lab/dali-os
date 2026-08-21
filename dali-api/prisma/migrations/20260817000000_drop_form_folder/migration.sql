-- Retire the legacy FormFolder tree. Forms are now organised purely by
-- Form.folderPageId (a Page of kind=Folder in the unified Drive); the old
-- /forms browser that used FormFolder was removed in the Drive migration.
--
-- DATA-LOSING: drops Form.folderId and the FormFolder table. This is gated on
-- the `form-folder-mirror` job having run in prod first, which backfills every
-- placed form's folderPageId from its FormFolder (mirror Pages carry systemKey
-- "formfolder:<id>"). See specs/drive-migration.md for the prod runbook.

-- DropForeignKey
ALTER TABLE "FormFolder" DROP CONSTRAINT "FormFolder_parentId_fkey";

-- DropForeignKey
ALTER TABLE "FormFolder" DROP CONSTRAINT "FormFolder_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Form" DROP CONSTRAINT "Form_folderId_fkey";

-- DropIndex
DROP INDEX "Form_folderId_idx";

-- AlterTable
ALTER TABLE "Form" DROP COLUMN "folderId";

-- DropTable
DROP TABLE "FormFolder";
