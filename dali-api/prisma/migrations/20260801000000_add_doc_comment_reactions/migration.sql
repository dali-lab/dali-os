-- AddTable: DocCommentReaction
-- Per-user emoji reactions on a DocComment. Toggle semantics (upsert on add,
-- delete on remove). Unique constraint enforces one row per (comment, user, emoji).
-- Additive only — no existing data affected.

CREATE TABLE "DocCommentReaction" (
    "id"        TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "emoji"     VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocCommentReaction_pkey" PRIMARY KEY ("id")
);

-- Unique: one reaction row per (comment, user, emoji)
CREATE UNIQUE INDEX "DocCommentReaction_commentId_userId_emoji_key"
    ON "DocCommentReaction"("commentId", "userId", "emoji");

-- Index for fast lookup of all reactions on a comment
CREATE INDEX "DocCommentReaction_commentId_idx"
    ON "DocCommentReaction"("commentId");

-- Cascade deletes when the comment or user is removed
ALTER TABLE "DocCommentReaction"
    ADD CONSTRAINT "DocCommentReaction_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "DocComment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocCommentReaction"
    ADD CONSTRAINT "DocCommentReaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
