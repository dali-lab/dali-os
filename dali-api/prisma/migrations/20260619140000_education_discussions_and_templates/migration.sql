-- Education: in-app discussions per offering and reusable application
-- templates. Pure additive — no existing rows touched.

-- ─── Discussions ────────────────────────────────────────────────────────────

CREATE TABLE "EducationDiscussionPost" (
    "id" TEXT NOT NULL,
    "offeringId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "parentPostId" TEXT,
    "isFromInstructor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "EducationDiscussionPost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EducationDiscussionPost_offeringId_parentPostId_createdAt_idx"
  ON "EducationDiscussionPost"("offeringId", "parentPostId", "createdAt");

ALTER TABLE "EducationDiscussionPost"
  ADD CONSTRAINT "EducationDiscussionPost_offeringId_fkey"
  FOREIGN KEY ("offeringId") REFERENCES "EducationOffering"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EducationDiscussionPost"
  ADD CONSTRAINT "EducationDiscussionPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EducationDiscussionPost"
  ADD CONSTRAINT "EducationDiscussionPost_parentPostId_fkey"
  FOREIGN KEY ("parentPostId") REFERENCES "EducationDiscussionPost"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "EducationDiscussionSubscription" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "EducationDiscussionSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EducationDiscussionSubscription_postId_userId_key"
  ON "EducationDiscussionSubscription"("postId", "userId");

CREATE INDEX "EducationDiscussionSubscription_userId_idx"
  ON "EducationDiscussionSubscription"("userId");

ALTER TABLE "EducationDiscussionSubscription"
  ADD CONSTRAINT "EducationDiscussionSubscription_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "EducationDiscussionPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EducationDiscussionSubscription"
  ADD CONSTRAINT "EducationDiscussionSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Application templates ──────────────────────────────────────────────────

CREATE TABLE "EducationApplicationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EducationApplicationTemplate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EducationApplicationTemplate"
  ADD CONSTRAINT "EducationApplicationTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "EducationApplicationTemplateQuestion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EducationApplicationTemplateQuestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EducationApplicationTemplateQuestion_templateId_position_idx"
  ON "EducationApplicationTemplateQuestion"("templateId", "position");

ALTER TABLE "EducationApplicationTemplateQuestion"
  ADD CONSTRAINT "EducationApplicationTemplateQuestion_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "EducationApplicationTemplate"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
