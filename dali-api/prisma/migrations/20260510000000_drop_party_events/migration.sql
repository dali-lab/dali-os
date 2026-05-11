-- DropForeignKey
ALTER TABLE "PartyEvent" DROP CONSTRAINT IF EXISTS "PartyEvent_userId_fkey";

-- DropTable
DROP TABLE IF EXISTS "PartyEvent";

-- DropEnum
DROP TYPE IF EXISTS "PartyEventType";

-- DropEnum
DROP TYPE IF EXISTS "PartyAudience";
