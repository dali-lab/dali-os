-- CreateTable
CREATE TABLE "TimesheetSection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hireKey" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "sourceEventKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimesheetSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimesheetSection_userId_startTime_idx" ON "TimesheetSection"("userId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetSection_userId_sourceEventKey_key" ON "TimesheetSection"("userId", "sourceEventKey");

-- AddForeignKey
ALTER TABLE "TimesheetSection" ADD CONSTRAINT "TimesheetSection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
