-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "aiTldr" TEXT,
ADD COLUMN     "aiTldrGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "aiTldrInputHash" TEXT;
