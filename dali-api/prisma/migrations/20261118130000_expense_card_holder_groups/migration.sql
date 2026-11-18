-- AlterTable
ALTER TABLE "ExpenseCard" ADD COLUMN     "holderGroupIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
