-- Member-owned, non-DALI paid roles, so hours worked outside the lab can be
-- attributed and exported to JobX as their own hire.
ALTER TYPE "AssignmentType" ADD VALUE 'Custom';

CREATE TABLE "CustomHire" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomHire_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomHire_userId_label_key" ON "CustomHire"("userId", "label");
CREATE INDEX "CustomHire_userId_archivedAt_idx" ON "CustomHire"("userId", "archivedAt");

ALTER TABLE "CustomHire" ADD CONSTRAINT "CustomHire_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
