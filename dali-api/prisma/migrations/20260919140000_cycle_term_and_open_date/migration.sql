-- Hiring phases are dated from the term a cycle runs in (Week N starts the
-- term's start date + N-1 weeks), and the application window gets a planned
-- open date alongside the existing close date. Both nullable: existing cycles
-- keep working and pick a term from setup.

-- AlterTable
ALTER TABLE "ApplicationCycle" ADD COLUMN "openDate" TIMESTAMP(3),
ADD COLUMN "termId" TEXT;

-- AddForeignKey
ALTER TABLE "ApplicationCycle" ADD CONSTRAINT "ApplicationCycle_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;
