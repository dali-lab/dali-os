-- Manual position of a member's card within its staffing-board column. The
-- column is derived from the member's assignment (or its absence = Unassigned);
-- this row records only the card's order within that column. One row per
-- (cycle, user); cards with no row fall back to last-name sort. Decoupled from
-- StaffingAssignment so Unassigned bidders can be ordered too. Additive; no
-- data loss.
CREATE TABLE "StaffingCardOrder" (
    "id" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "columnKey" TEXT NOT NULL,
    "sortKey" INTEGER NOT NULL,
    CONSTRAINT "StaffingCardOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffingCardOrder_staffingCycleId_userId_key" ON "StaffingCardOrder"("staffingCycleId", "userId");

CREATE INDEX "StaffingCardOrder_staffingCycleId_columnKey_idx" ON "StaffingCardOrder"("staffingCycleId", "columnKey");

ALTER TABLE "StaffingCardOrder" ADD CONSTRAINT "StaffingCardOrder_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffingCardOrder" ADD CONSTRAINT "StaffingCardOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
