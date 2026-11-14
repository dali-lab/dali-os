-- CreateTable
CREATE TABLE "TunnelRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "endedBy" TEXT NOT NULL DEFAULT 'fall',
    "obstacle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TunnelRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TunnelRun_createdAt_idx" ON "TunnelRun"("createdAt");

-- CreateIndex
CREATE INDEX "TunnelRun_userId_idx" ON "TunnelRun"("userId");

-- AddForeignKey
ALTER TABLE "TunnelRun" ADD CONSTRAINT "TunnelRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
