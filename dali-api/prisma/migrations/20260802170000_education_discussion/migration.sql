-- Announcements become a discussion: posts carry a kind (Announcement fans out
-- a notification, Message doesn't) and can be replies to a top-level post.
-- Existing rows were all instructor announcements, which is the enum default.
CREATE TYPE "EduPostKind" AS ENUM ('Announcement', 'Message');

ALTER TABLE "EducationAnnouncement"
  ADD COLUMN "kind" "EduPostKind" NOT NULL DEFAULT 'Announcement',
  ADD COLUMN "parentId" TEXT;

CREATE INDEX "EducationAnnouncement_parentId_sentAt_idx"
  ON "EducationAnnouncement"("parentId", "sentAt");

ALTER TABLE "EducationAnnouncement" ADD CONSTRAINT "EducationAnnouncement_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "EducationAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
