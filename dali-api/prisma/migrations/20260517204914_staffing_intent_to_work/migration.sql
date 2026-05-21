-- CreateEnum
CREATE TYPE "IntentStatus" AS ENUM ('Returning', 'Off', 'Graduating', 'Leave', 'Unsure');

-- CreateTable
CREATE TABLE "IntentToWork" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "status" "IntentStatus" NOT NULL,
    "notes" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntentToWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntentToWork_staffingCycleId_termId_idx" ON "IntentToWork"("staffingCycleId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "IntentToWork_userId_staffingCycleId_termId_key" ON "IntentToWork"("userId", "staffingCycleId", "termId");

-- AddForeignKey
ALTER TABLE "IntentToWork" ADD CONSTRAINT "IntentToWork_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentToWork" ADD CONSTRAINT "IntentToWork_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentToWork" ADD CONSTRAINT "IntentToWork_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
