-- CreateTable
CREATE TABLE "DinoScore" (
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DinoScore_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "DinoScore_score_idx" ON "DinoScore"("score");

-- AddForeignKey
ALTER TABLE "DinoScore" ADD CONSTRAINT "DinoScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
