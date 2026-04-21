-- CreateTable
CREATE TABLE "Rubric" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Rubric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RubricVersion" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versionNumber" INTEGER NOT NULL,
    "criteria" JSONB NOT NULL,
    "rubricId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "applicationFormVersionId" TEXT,
    "challengeVersionId" TEXT,

    CONSTRAINT "RubricVersion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_rubricId_fkey" FOREIGN KEY ("rubricId") REFERENCES "Rubric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_applicationFormVersionId_fkey" FOREIGN KEY ("applicationFormVersionId") REFERENCES "ApplicationFormVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RubricVersion" ADD CONSTRAINT "RubricVersion_challengeVersionId_fkey" FOREIGN KEY ("challengeVersionId") REFERENCES "ChallengeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
