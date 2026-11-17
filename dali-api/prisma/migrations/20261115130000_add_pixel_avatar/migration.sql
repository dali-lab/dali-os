-- CreateTable
CREATE TABLE "PixelAvatar" (
    "userId" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "skinTone" TEXT NOT NULL,
    "hairstyle" TEXT NOT NULL,
    "questAcceptedAt" TIMESTAMP(3),
    "questCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PixelAvatar_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "PixelAvatar" ADD CONSTRAINT "PixelAvatar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
