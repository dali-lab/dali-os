-- AlterTable
ALTER TABLE "MeetingRecording" ADD COLUMN     "voicedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[];
