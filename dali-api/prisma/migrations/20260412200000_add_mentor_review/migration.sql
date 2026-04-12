-- CreateTable
CREATE TABLE "MentorReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "feedback" TEXT NOT NULL DEFAULT '',
    "rejectionRationale" TEXT NOT NULL DEFAULT '',
    "overallRecommendation" TEXT,
    "annotations" JSONB NOT NULL DEFAULT '[]',
    "mentorId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,

    CONSTRAINT "MentorReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MentorReview_mentorId_applicationId_key" ON "MentorReview"("mentorId", "applicationId");

-- AddForeignKey
ALTER TABLE "MentorReview" ADD CONSTRAINT "MentorReview_mentorId_fkey" FOREIGN KEY ("mentorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorReview" ADD CONSTRAINT "MentorReview_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
