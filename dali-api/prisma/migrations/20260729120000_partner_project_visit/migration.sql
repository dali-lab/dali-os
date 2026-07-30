-- CreateTable
CREATE TABLE "PartnerProjectVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerProjectVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerProjectVisit_userId_idx" ON "PartnerProjectVisit"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProjectVisit_userId_projectId_key" ON "PartnerProjectVisit"("userId", "projectId");
