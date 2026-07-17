-- DropForeignKey
ALTER TABLE "NotificationEvent" DROP CONSTRAINT "NotificationEvent_recipientId_fkey";

-- DropForeignKey
ALTER TABLE "NotificationPreference" DROP CONSTRAINT "NotificationPreference_userId_fkey";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "eventType" TEXT NOT NULL DEFAULT 'general',
ADD COLUMN     "slackDmAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "NotificationPreference" DROP COLUMN "email",
ADD COLUMN     "slackDm" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "digestFrequency" SET DEFAULT 'Off';

-- DropTable
DROP TABLE "NotificationEvent";

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

