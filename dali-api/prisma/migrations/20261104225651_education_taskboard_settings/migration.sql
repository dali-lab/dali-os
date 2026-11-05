-- CreateTable
CREATE TABLE "EducationTaskboardSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "termWeeks" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EducationTaskboardSettings_pkey" PRIMARY KEY ("id")
);
