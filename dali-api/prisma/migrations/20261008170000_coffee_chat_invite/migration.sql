-- Anonymous coffee chat invites sent from a profile. Additive only.

-- CreateEnum
CREATE TYPE "CoffeeChatStatus" AS ENUM ('Pending', 'Accepted', 'Declined');

-- CreateTable
CREATE TABLE "CoffeeChatInvite" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "status" "CoffeeChatStatus" NOT NULL DEFAULT 'Pending',
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "CoffeeChatInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoffeeChatInvite_senderId_recipientId_idx" ON "CoffeeChatInvite"("senderId", "recipientId");

-- CreateIndex
CREATE INDEX "CoffeeChatInvite_recipientId_idx" ON "CoffeeChatInvite"("recipientId");

-- AddForeignKey
ALTER TABLE "CoffeeChatInvite" ADD CONSTRAINT "CoffeeChatInvite_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoffeeChatInvite" ADD CONSTRAINT "CoffeeChatInvite_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

