-- AlterTable
ALTER TABLE "Form" ADD COLUMN     "lastRemindedAt" TIMESTAMP(3),
ADD COLUMN     "remindBeforeClose" BOOLEAN NOT NULL DEFAULT false;
