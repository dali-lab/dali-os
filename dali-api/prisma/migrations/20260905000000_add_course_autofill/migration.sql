-- AlterTable
ALTER TABLE "MemberClass" ADD COLUMN     "courseNumber" TEXT,
ADD COLUMN     "offeringCrn" TEXT,
ADD COLUMN     "section" TEXT,
ADD COLUMN     "subject" TEXT;

-- CreateTable
CREATE TABLE "CourseOffering" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "oracleTerm" TEXT NOT NULL,
    "crn" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodCode" TEXT,
    "periodText" TEXT,
    "building" TEXT,
    "room" TEXT,
    "instructor" TEXT,
    "crosslist" TEXT,
    "searchText" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseOffering_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseOffering_termId_subject_number_idx" ON "CourseOffering"("termId", "subject", "number");

-- CreateIndex
CREATE INDEX "CourseOffering_termId_searchText_idx" ON "CourseOffering"("termId", "searchText");

-- CreateIndex
CREATE UNIQUE INDEX "CourseOffering_termId_crn_key" ON "CourseOffering"("termId", "crn");

-- AddForeignKey
ALTER TABLE "CourseOffering" ADD CONSTRAINT "CourseOffering_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;
