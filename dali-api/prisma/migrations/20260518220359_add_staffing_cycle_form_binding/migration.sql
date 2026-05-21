-- CreateTable
CREATE TABLE "StaffingCycleFormBinding" (
    "id" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "StaffingCycleFormBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffingCycleFormBinding_formId_idx" ON "StaffingCycleFormBinding"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffingCycleFormBinding_staffingCycleId_slot_key" ON "StaffingCycleFormBinding"("staffingCycleId", "slot");

-- AddForeignKey
ALTER TABLE "StaffingCycleFormBinding" ADD CONSTRAINT "StaffingCycleFormBinding_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingCycleFormBinding" ADD CONSTRAINT "StaffingCycleFormBinding_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffingCycleFormBinding" ADD CONSTRAINT "StaffingCycleFormBinding_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
