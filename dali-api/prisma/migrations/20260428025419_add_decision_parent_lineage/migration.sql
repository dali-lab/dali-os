-- AlterTable
ALTER TABLE "Decision" ADD COLUMN "parentDecisionId" TEXT;

-- CreateIndex
CREATE INDEX "Decision_parentDecisionId_idx" ON "Decision"("parentDecisionId");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_parentDecisionId_fkey" FOREIGN KEY ("parentDecisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
