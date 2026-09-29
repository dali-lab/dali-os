-- CreateEnum
CREATE TYPE "RoomBookingSource" AS ENUM ('Web', 'Display', 'App');

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "capacity" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomBooking" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "source" "RoomBookingSource" NOT NULL DEFAULT 'Web',
    "cancelledAt" TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomDisplay" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "setupCodeHash" TEXT,
    "setupCodeExpiresAt" TIMESTAMP(3),
    "tokenHash" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomDisplay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RoomToScheduledMeeting" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RoomToScheduledMeeting_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "RoomBooking_roomId_start_idx" ON "RoomBooking"("roomId", "start");

-- CreateIndex
CREATE INDEX "RoomBooking_userId_start_idx" ON "RoomBooking"("userId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "RoomDisplay_setupCodeHash_key" ON "RoomDisplay"("setupCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "RoomDisplay_tokenHash_key" ON "RoomDisplay"("tokenHash");

-- CreateIndex
CREATE INDEX "RoomDisplay_roomId_idx" ON "RoomDisplay"("roomId");

-- CreateIndex
CREATE INDEX "_RoomToScheduledMeeting_B_index" ON "_RoomToScheduledMeeting"("B");

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBooking" ADD CONSTRAINT "RoomBooking_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDisplay" ADD CONSTRAINT "RoomDisplay_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomDisplay" ADD CONSTRAINT "RoomDisplay_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoomToScheduledMeeting" ADD CONSTRAINT "_RoomToScheduledMeeting_A_fkey" FOREIGN KEY ("A") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoomToScheduledMeeting" ADD CONSTRAINT "_RoomToScheduledMeeting_B_fkey" FOREIGN KEY ("B") REFERENCES "ScheduledMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

