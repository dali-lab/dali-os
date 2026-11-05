-- AlterTable
ALTER TABLE "ProjectFile" ADD COLUMN     "linkAccess" "LinkAccess" NOT NULL DEFAULT 'Restricted',
ADD COLUMN     "linkPermission" "SharePermission" NOT NULL DEFAULT 'View';

-- CreateTable
CREATE TABLE "FileShare" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "principalType" "SharePrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "permission" "SharePermission" NOT NULL DEFAULT 'View',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FileShare_principalType_principalId_idx" ON "FileShare"("principalType", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "FileShare_fileId_principalType_principalId_key" ON "FileShare"("fileId", "principalType", "principalId");

-- AddForeignKey
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ProjectFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
