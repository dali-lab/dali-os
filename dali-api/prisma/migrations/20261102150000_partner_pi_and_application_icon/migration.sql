-- AlterTable
ALTER TABLE "PartnerApplication" ADD COLUMN     "iconEmoji" TEXT,
ADD COLUMN     "piUserId" TEXT;

-- AlterTable
ALTER TABLE "ProjectTerm" ADD COLUMN     "piUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ProjectTerm" ADD CONSTRAINT "ProjectTerm_piUserId_fkey" FOREIGN KEY ("piUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_piUserId_fkey" FOREIGN KEY ("piUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
