-- CreateTable
CREATE TABLE "MailDraftAttachment" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailDraftAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailDraftAttachment_draftId_idx" ON "MailDraftAttachment"("draftId");

-- AddForeignKey
ALTER TABLE "MailDraftAttachment" ADD CONSTRAINT "MailDraftAttachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "MailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
