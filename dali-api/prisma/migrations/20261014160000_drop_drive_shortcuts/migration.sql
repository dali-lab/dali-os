-- Drive shortcuts are removed. DATA-LOSING: drops Page.targetPageId and
-- Page.grantShareId, so any existing Shortcut rows lose their target. Nothing
-- creates the 'Shortcut' PageKind value any more; it stays in the enum because
-- Postgres cannot drop an enum value cheaply.

-- DropIndex
DROP INDEX "Page_shortcut_target_parent_live";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_targetPageId_fkey";

-- DropForeignKey
ALTER TABLE "Page" DROP CONSTRAINT "Page_grantShareId_fkey";

-- DropIndex
DROP INDEX "Page_targetPageId_idx";

-- DropIndex
DROP INDEX "Page_grantShareId_idx";

-- AlterTable
ALTER TABLE "Page" DROP COLUMN "grantShareId",
DROP COLUMN "targetPageId";
