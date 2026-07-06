-- A member a staffing lead manually placed on the board for a cycle WITHOUT a
-- bid. The board pool is otherwise derived from StaffingPreference / bid
-- submissions; this row makes a non-bidder appear as an Unassigned card the
-- lead can drag into a project. Additive; no data loss.
CREATE TABLE "StaffingBoardMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffingCycleId" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffingBoardMember_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffingBoardMember_userId_staffingCycleId_key" ON "StaffingBoardMember"("userId", "staffingCycleId");

ALTER TABLE "StaffingBoardMember" ADD CONSTRAINT "StaffingBoardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffingBoardMember" ADD CONSTRAINT "StaffingBoardMember_staffingCycleId_fkey" FOREIGN KEY ("staffingCycleId") REFERENCES "StaffingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
