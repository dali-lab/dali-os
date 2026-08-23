-- CreateTable
CREATE TABLE "SignRequestNotification" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bindingId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,

    CONSTRAINT "SignRequestNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignRequestNotification_bindingId_versionId_idx" ON "SignRequestNotification"("bindingId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "SignRequestNotification_bindingId_versionId_signerUserId_key" ON "SignRequestNotification"("bindingId", "versionId", "signerUserId");

-- AddForeignKey
ALTER TABLE "SignRequestNotification" ADD CONSTRAINT "SignRequestNotification_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "SigningBinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

