/*
  Warnings:

  - A unique constraint covering the columns `[dartmouthEmail]` on the table `DALIMember` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[did]` on the table `DALIMember` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "DALIMember" ADD COLUMN     "dartmouthEmail" TEXT,
ADD COLUMN     "did" TEXT,
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_dartmouthEmail_key" ON "DALIMember"("dartmouthEmail");

-- CreateIndex
CREATE UNIQUE INDEX "DALIMember_did_key" ON "DALIMember"("did");
