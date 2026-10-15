-- CreateTable
CREATE TABLE "TetrisScore" (
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "lines" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TetrisScore_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "TetrisScore_score_idx" ON "TetrisScore"("score");

-- AddForeignKey
ALTER TABLE "TetrisScore" ADD CONSTRAINT "TetrisScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
