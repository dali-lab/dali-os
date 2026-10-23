-- DropForeignKey
ALTER TABLE "ChatConversation" DROP CONSTRAINT "ChatConversation_createdById_fkey";

-- DropForeignKey
ALTER TABLE "ChatMember" DROP CONSTRAINT "ChatMember_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMember" DROP CONSTRAINT "ChatMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_authorId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_parentId_fkey";

-- DropForeignKey
ALTER TABLE "ChatReaction" DROP CONSTRAINT "ChatReaction_messageId_fkey";

-- DropForeignKey
ALTER TABLE "ChatReaction" DROP CONSTRAINT "ChatReaction_userId_fkey";

-- DropForeignKey
ALTER TABLE "MobilePushToken" DROP CONSTRAINT "MobilePushToken_userId_fkey";

-- DropTable
DROP TABLE "ChatConversation";

-- DropTable
DROP TABLE "ChatMember";

-- DropTable
DROP TABLE "ChatMessage";

-- DropTable
DROP TABLE "ChatReaction";

-- DropTable
DROP TABLE "MobilePushToken";

-- DropEnum
DROP TYPE "ChatConversationKind";

-- DropEnum
DROP TYPE "ChatMessageKind";

-- DropEnum
DROP TYPE "MobilePushPlatform";

