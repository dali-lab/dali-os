-- CreateTable
CREATE TABLE "CritSubmission" (
    "id" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "authorId" TEXT,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "previewUrl" TEXT,
    "fileName" TEXT,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CritSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CritComment" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "authorId" TEXT,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CritComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CritSubmission_domainId_createdAt_idx" ON "CritSubmission"("domainId", "createdAt");

-- CreateIndex
CREATE INDEX "CritComment_submissionId_createdAt_idx" ON "CritComment"("submissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "CritSubmission" ADD CONSTRAINT "CritSubmission_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CritSubmission" ADD CONSTRAINT "CritSubmission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CritComment" ADD CONSTRAINT "CritComment_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "CritSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CritComment" ADD CONSTRAINT "CritComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CritComment" ADD CONSTRAINT "CritComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CritComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
