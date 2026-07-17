-- CreateEnum
CREATE TYPE "InterviewReminderKind" AS ENUM ('DayBefore', 'HourBefore');

-- CreateTable
CREATE TABLE "InterviewReminderLog" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "kind" "InterviewReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterviewReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InterviewReminderLog_interviewId_kind_key" ON "InterviewReminderLog"("interviewId", "kind");

-- AddForeignKey
ALTER TABLE "InterviewReminderLog" ADD CONSTRAINT "InterviewReminderLog_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
