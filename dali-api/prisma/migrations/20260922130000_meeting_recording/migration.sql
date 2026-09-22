-- CreateEnum
CREATE TYPE "MeetingRecordingStatus" AS ENUM ('Pending', 'Recording', 'Stopped', 'Failed');

-- CreateTable
CREATE TABLE "MeetingRecording" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MeetingRecordingStatus" NOT NULL DEFAULT 'Pending',
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "systemAudio" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingRecording_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingRecording_userId_idx" ON "MeetingRecording"("userId");
