-- CreateTable
CREATE TABLE "EpicDependency" (
    "id" TEXT NOT NULL,
    "epicId" TEXT NOT NULL,
    "dependsOnEpicId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpicDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EpicDependency_dependsOnEpicId_idx" ON "EpicDependency"("dependsOnEpicId");

-- CreateIndex
CREATE UNIQUE INDEX "EpicDependency_epicId_dependsOnEpicId_key" ON "EpicDependency"("epicId", "dependsOnEpicId");

-- AddForeignKey
ALTER TABLE "EpicDependency" ADD CONSTRAINT "EpicDependency_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpicDependency" ADD CONSTRAINT "EpicDependency_dependsOnEpicId_fkey" FOREIGN KEY ("dependsOnEpicId") REFERENCES "Epic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
