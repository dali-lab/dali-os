-- Partner pipeline overhaul + PartnerMeetingNote
--
-- 1. Rename old PartnerApplicationStatus enum values that map cleanly to new
--    names. Values with no equivalent are mapped to Submitted (safe: these are
--    mock/seed rows only — the partner lead confirmed all existing data is
--    disposable / can be re-seeded).
-- 2. Add the six new status values that have no old counterpart.
-- 3. Drop the two old values that are gone (UnderReview, OnHold) — after
--    mapping any existing rows away from them.
-- 4. Create PartnerMeetingNote table + MeetingCategory enum.
-- 5. Add PartnerOrg.meetingNotes back-relation (FK on PartnerMeetingNote, no
--    column on PartnerOrg).

-- ─── Step 1: rename old enum, create a bridge enum with all values ───────────
-- Postgres can't drop enum values, so we recreate the type. But the USING cast
-- during ALTER COLUMN fails if existing rows hold values not in the new enum
-- (UnderReview, OnHold). Solution: use a CASE in the USING expression to remap
-- old values inline, avoiding the need for an intermediate bridge enum.

ALTER TYPE "PartnerApplicationStatus" RENAME TO "PartnerApplicationStatus_old";

CREATE TYPE "PartnerApplicationStatus" AS ENUM (
  'Submitted',
  'RejectedPreInterview',
  'InterviewInviteSent',
  'InterviewScheduled',
  'RejectedPostInterview',
  'InterviewCompleted',
  'Accepted',
  'ScopeCreated',
  'ScopeApproved',
  'ConfirmedStart'
);

-- ─── Step 2: migrate column, remapping old values inline ─────────────────────
-- The CASE converts removed enum values to their new equivalents so the cast
-- never encounters an invalid label.
ALTER TABLE "PartnerApplication"
  ALTER COLUMN status TYPE "PartnerApplicationStatus"
  USING (
    CASE status::text
      WHEN 'UnderReview' THEN 'InterviewInviteSent'
      WHEN 'OnHold'      THEN 'Submitted'
      ELSE status::text
    END
  )::"PartnerApplicationStatus";

DROP TYPE "PartnerApplicationStatus_old";

-- ─── Step 3: MeetingCategory enum ────────────────────────────────────────────

CREATE TYPE "MeetingCategory" AS ENUM (
  'Partner',
  'Student',
  'DALI',
  'Faculty',
  'Other'
);

-- ─── Step 4: PartnerMeetingNote table ─────────────────────────────────────────

CREATE TABLE "PartnerMeetingNote" (
    "id"           TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "meetingDate"  TIMESTAMP(3) NOT NULL,
    "category"     "MeetingCategory" NOT NULL,
    "attendees"    TEXT NOT NULL DEFAULT '',
    "contentDocId" TEXT,
    "partnerOrgId" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerMeetingNote_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on contentDocId (one note ↔ one collab doc).
CREATE UNIQUE INDEX "PartnerMeetingNote_contentDocId_key"
  ON "PartnerMeetingNote"("contentDocId");

-- Indexes to back the filter/sort queries.
CREATE INDEX "PartnerMeetingNote_partnerOrgId_idx"
  ON "PartnerMeetingNote"("partnerOrgId");

CREATE INDEX "PartnerMeetingNote_category_idx"
  ON "PartnerMeetingNote"("category");

CREATE INDEX "PartnerMeetingNote_meetingDate_idx"
  ON "PartnerMeetingNote"("meetingDate" DESC);

-- FK to PartnerOrg (SetNull on delete so orphaned notes survive org removal).
ALTER TABLE "PartnerMeetingNote"
  ADD CONSTRAINT "PartnerMeetingNote_partnerOrgId_fkey"
  FOREIGN KEY ("partnerOrgId")
  REFERENCES "PartnerOrg"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
