-- Track a partner's last visit to a project hub, so it can show "what's new
-- since your last visit". One row per (user, project).
CREATE TABLE "PartnerProjectVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerProjectVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerProjectVisit_userId_projectId_key" ON "PartnerProjectVisit"("userId", "projectId");

-- CreateIndex
CREATE INDEX "PartnerProjectVisit_userId_idx" ON "PartnerProjectVisit"("userId");
