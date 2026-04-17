-- CreateTable
CREATE TABLE "CollabDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollabDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollabDocumentVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "plainText" TEXT NOT NULL,
    "authorIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollabDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CollabDocument_name_key" ON "CollabDocument"("name");

-- CreateIndex
CREATE INDEX "CollabDocumentVersion_name_createdAt_idx" ON "CollabDocumentVersion"("name", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "CollabDocumentVersion" ADD CONSTRAINT "CollabDocumentVersion_name_fkey" FOREIGN KEY ("name") REFERENCES "CollabDocument"("name") ON DELETE CASCADE ON UPDATE CASCADE;
