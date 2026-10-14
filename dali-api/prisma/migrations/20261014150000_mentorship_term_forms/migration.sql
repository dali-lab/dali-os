-- CreateTable
CREATE TABLE "MentorshipTermForm" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "termId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "formId" TEXT NOT NULL,

    CONSTRAINT "MentorshipTermForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MentorshipTermForm_formId_idx" ON "MentorshipTermForm"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "MentorshipTermForm_termId_role_key" ON "MentorshipTermForm"("termId", "role");

-- AddForeignKey
ALTER TABLE "MentorshipTermForm" ADD CONSTRAINT "MentorshipTermForm_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MentorshipTermForm" ADD CONSTRAINT "MentorshipTermForm_formId_fkey" FOREIGN KEY ("formId") REFERENCES "Form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

