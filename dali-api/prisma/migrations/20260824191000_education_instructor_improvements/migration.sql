-- Configurable completion threshold (Miniseries), default 80%.
ALTER TABLE "EducationOffering" ADD COLUMN "completionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.8;

-- Optional assignment points + submission score (informational).
ALTER TABLE "EducationAssignment" ADD COLUMN "points" INTEGER;
ALTER TABLE "EducationSubmission" ADD COLUMN "score" INTEGER;

-- Optional material -> session link (loose FK to EducationSession).
ALTER TABLE "Page" ADD COLUMN "sessionId" TEXT;
