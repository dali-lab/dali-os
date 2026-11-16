-- CreateTable
CREATE TABLE "AlumniChatMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlumniChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AlumniChatMessage_userId_createdAt_idx" ON "AlumniChatMessage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AlumniChatMessage" ADD CONSTRAINT "AlumniChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
