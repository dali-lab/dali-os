-- CreateTable
CREATE TABLE "TechnigalaAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "TechnigalaAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TechnigalaAssignment_termId_idx" ON "TechnigalaAssignment"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "TechnigalaAssignment_userId_termId_key" ON "TechnigalaAssignment"("userId", "termId");

-- AddForeignKey
ALTER TABLE "TechnigalaAssignment" ADD CONSTRAINT "TechnigalaAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TechnigalaAssignment" ADD CONSTRAINT "TechnigalaAssignment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
