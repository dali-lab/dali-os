/*
  Warnings:

  - You are about to drop the column `slides` on the `SlideDeck` table. All the data in the column will be lost.
  - You are about to drop the column `storage` on the `SlideDeck` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "SlideDeck" DROP COLUMN "slides",
DROP COLUMN "storage";
