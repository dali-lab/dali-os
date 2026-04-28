/*
  Warnings:

  - You are about to drop the column `domainId` on the `Rubric` table. All existing per-rubric domain affiliations will be lost. Per-cycle bindings via `DomainApplicationCycle.rubricVersionId` are unaffected.

*/
-- DropForeignKey
ALTER TABLE "Rubric" DROP CONSTRAINT "Rubric_domainId_fkey";

-- AlterTable
ALTER TABLE "Rubric" DROP COLUMN "domainId";
