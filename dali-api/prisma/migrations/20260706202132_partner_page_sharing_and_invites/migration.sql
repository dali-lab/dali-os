-- AlterTable
ALTER TABLE "Page" ADD COLUMN     "partnerVisible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PartnerInvite" (
    "id" TEXT NOT NULL,
    "partnerOrgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayRole" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartnerInvite_tokenHash_key" ON "PartnerInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "PartnerInvite_partnerOrgId_idx" ON "PartnerInvite"("partnerOrgId");

-- CreateIndex
CREATE INDEX "PartnerInvite_email_idx" ON "PartnerInvite"("email");

-- AddForeignKey
ALTER TABLE "PartnerInvite" ADD CONSTRAINT "PartnerInvite_partnerOrgId_fkey" FOREIGN KEY ("partnerOrgId") REFERENCES "PartnerOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
