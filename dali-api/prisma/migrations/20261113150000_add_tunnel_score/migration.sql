-- CreateTable
CREATE TABLE "TunnelScore" (
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TunnelScore_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "TunnelScore_score_idx" ON "TunnelScore"("score");

-- AddForeignKey
ALTER TABLE "TunnelScore" ADD CONSTRAINT "TunnelScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
