-- CreateTable
CREATE TABLE "AlumniInvite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sentTo" TEXT NOT NULL,
    "batch" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlumniInvite_tokenHash_key" ON "AlumniInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "AlumniInvite_userId_idx" ON "AlumniInvite"("userId");

-- AddForeignKey
ALTER TABLE "AlumniInvite" ADD CONSTRAINT "AlumniInvite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
