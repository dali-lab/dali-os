-- CreateEnum
CREATE TYPE "TimesheetImportKind" AS ENUM ('Timesheet', 'Notes');

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "termId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetEntry" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "employeeNetId" TEXT NOT NULL,
    "employeeName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "chartString" TEXT NOT NULL,
    "shiftStartTime" TEXT NOT NULL,
    "shiftEndTime" TEXT NOT NULL,
    "totalShiftTime" DECIMAL(65,30) NOT NULL,
    "hourlyPayRate" DECIMAL(65,30) NOT NULL,
    "totalEarnings" DECIMAL(65,30) NOT NULL,
    "overtimeHours" DECIMAL(65,30),
    "overtimeEarnings" DECIMAL(65,30),
    "payCode" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "supervisorName" TEXT NOT NULL,
    "timesheetStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetNote" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "netId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "noteHash" TEXT NOT NULL,
    "validatedChartstring" TEXT,
    "linkToTimesheet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimesheetImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "kind" "TimesheetImportKind" NOT NULL,
    "payPeriodId" TEXT,
    "rowsCreated" INTEGER NOT NULL,
    "rowsSkippedDuplicates" INTEGER NOT NULL,
    "rowsDeletedPrior" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimesheetImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "chartString" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "revenue" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "projectType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetNote" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "chartString" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_name_key" ON "PayPeriod"("name");

-- CreateIndex
CREATE INDEX "PayPeriod_termId_idx" ON "PayPeriod"("termId");

-- CreateIndex
CREATE INDEX "TimesheetEntry_payPeriodId_employeeNetId_idx" ON "TimesheetEntry"("payPeriodId", "employeeNetId");

-- CreateIndex
CREATE INDEX "TimesheetEntry_employeeNetId_jobId_idx" ON "TimesheetEntry"("employeeNetId", "jobId");

-- CreateIndex
CREATE INDEX "TimesheetEntry_chartString_idx" ON "TimesheetEntry"("chartString");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetEntry_payPeriodId_employeeNetId_jobId_shiftStartTi_key" ON "TimesheetEntry"("payPeriodId", "employeeNetId", "jobId", "shiftStartTime", "shiftEndTime", "chartString", "payCode");

-- CreateIndex
CREATE INDEX "TimesheetNote_payPeriodId_netId_idx" ON "TimesheetNote"("payPeriodId", "netId");

-- CreateIndex
CREATE UNIQUE INDEX "TimesheetNote_payPeriodId_netId_jobId_noteHash_key" ON "TimesheetNote"("payPeriodId", "netId", "jobId", "noteHash");

-- CreateIndex
CREATE INDEX "TimesheetImport_payPeriodId_idx" ON "TimesheetImport"("payPeriodId");

-- CreateIndex
CREATE INDEX "TimesheetImport_uploadedById_idx" ON "TimesheetImport"("uploadedById");

-- CreateIndex
CREATE INDEX "BudgetEntry_termId_idx" ON "BudgetEntry"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetEntry_projectId_chartString_termId_key" ON "BudgetEntry"("projectId", "chartString", "termId");

-- CreateIndex
CREATE INDEX "BudgetNote_termId_idx" ON "BudgetNote"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetNote_projectId_chartString_termId_key" ON "BudgetNote"("projectId", "chartString", "termId");

-- AddForeignKey
ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetEntry" ADD CONSTRAINT "TimesheetEntry_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetNote" ADD CONSTRAINT "TimesheetNote_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetImport" ADD CONSTRAINT "TimesheetImport_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimesheetImport" ADD CONSTRAINT "TimesheetImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetEntry" ADD CONSTRAINT "BudgetEntry_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetNote" ADD CONSTRAINT "BudgetNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetNote" ADD CONSTRAINT "BudgetNote_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
