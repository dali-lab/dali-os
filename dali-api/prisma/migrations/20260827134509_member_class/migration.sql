-- CreateTable
CREATE TABLE "MemberClass" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodCode" TEXT,
    "meetings" JSONB NOT NULL,
    "location" TEXT,
    "storage" TEXT NOT NULL DEFAULT 'Local',
    "linkId" TEXT,
    "calendarId" TEXT,
    "googleEventIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberClass_userId_termId_idx" ON "MemberClass"("userId", "termId");

-- AddForeignKey
ALTER TABLE "MemberClass" ADD CONSTRAINT "MemberClass_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberClass" ADD CONSTRAINT "MemberClass_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
