-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "ExpensePaidWith" AS ENUM ('STAFF_CARD', 'OWN_CARD');

-- CreateEnum
CREATE TYPE "ExpenseReceiptKind" AS ENUM ('PAYMENT_PROOF', 'ITEMIZED', 'OTHER');

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "paidWith" "ExpensePaidWith",
    "cardId" TEXT,
    "statementChargeId" TEXT,
    "merchant" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "total" DECIMAL(12,2),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "purpose" TEXT,
    "categoryId" TEXT,
    "chartString" TEXT,
    "termId" TEXT,
    "projectId" TEXT,
    "attendeeIds" TEXT[],
    "noReceipt" BOOLEAN NOT NULL DEFAULT false,
    "noReceiptReason" TEXT,
    "extraction" JSONB,
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseReceipt" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "ExpenseReceiptKind" NOT NULL,
    "extracted" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "chartString" TEXT,
    "hints" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCard" (
    "id" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "holderIds" TEXT[],
    "defaultCategoryId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardStatementCharge" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "rawRow" JSONB NOT NULL,
    "refundOfChargeId" TEXT,
    "importedById" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardStatementCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_statementChargeId_key" ON "Expense"("statementChargeId");

-- CreateIndex
CREATE INDEX "Expense_submitterId_status_idx" ON "Expense"("submitterId", "status");

-- CreateIndex
CREATE INDEX "Expense_cardId_status_idx" ON "Expense"("cardId", "status");

-- CreateIndex
CREATE INDEX "Expense_status_idx" ON "Expense"("status");

-- CreateIndex
CREATE INDEX "Expense_termId_idx" ON "Expense"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseReceipt_s3Key_key" ON "ExpenseReceipt"("s3Key");

-- CreateIndex
CREATE INDEX "ExpenseReceipt_expenseId_idx" ON "ExpenseReceipt"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseReceipt_sha256_idx" ON "ExpenseReceipt"("sha256");

-- CreateIndex
CREATE INDEX "CardStatementCharge_cardId_postedAt_idx" ON "CardStatementCharge"("cardId", "postedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatementCharge_cardId_fingerprint_key" ON "CardStatementCharge"("cardId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ExpenseCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_statementChargeId_fkey" FOREIGN KEY ("statementChargeId") REFERENCES "CardStatementCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseReceipt" ADD CONSTRAINT "ExpenseReceipt_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCard" ADD CONSTRAINT "ExpenseCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCard" ADD CONSTRAINT "ExpenseCard_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatementCharge" ADD CONSTRAINT "CardStatementCharge_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "ExpenseCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatementCharge" ADD CONSTRAINT "CardStatementCharge_refundOfChargeId_fkey" FOREIGN KEY ("refundOfChargeId") REFERENCES "CardStatementCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Seed categories from the Reimbursement doc
INSERT INTO "ExpenseCategory" ("id", "label", "chartString", "hints", "sortOrder") VALUES
  ('expcat_projects', 'Projects', '20.330.161028.128512.4000', ARRAY['project','client','partner','hosting','software','subscription'], 0),
  ('expcat_programs', 'General and socials', '20.330.161028.128512.3000', ARRAY['social','team meal','snacks','pizza','food','lab supplies','general'], 1),
  ('expcat_technigala', 'Technigala', '20.330.161028.128512.3200', ARRAY['technigala','gala','poster','certificate','frame'], 2),
  ('expcat_miniseries', 'Miniseries', '20.330.161028.128512.3300', ARRAY['miniseries','mini series'], 3),
  ('expcat_workshops', 'Workshops', '20.330.161028.128512.3400', ARRAY['workshop','speaker','instructor'], 4),
  ('expcat_fellowships', 'Fellowships', '20.330.161028.128512.3500', ARRAY['fellowship','fellow'], 5),
  ('expcat_immersion', 'Immersion', '20.330.161028.128512.3100', ARRAY['immersion','retreat'], 6);
