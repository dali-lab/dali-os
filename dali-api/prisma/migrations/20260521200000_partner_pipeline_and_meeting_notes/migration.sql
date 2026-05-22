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

-- ─── Step 1: map existing rows to valid new statuses before touching the enum ─

-- UnderReview → InterviewInviteSent (closest pipeline equivalent)
-- OnHold      → Submitted           (park back at start)
UPDATE "PartnerApplication"
SET status = 'InterviewInviteSent'
WHERE status = 'UnderReview';

UPDATE "PartnerApplication"
SET status = 'Submitted'
WHERE status = 'OnHold';

-- ─── Step 2: rename / add enum values via a type-swap ────────────────────────
-- Postgres doesn't support DROP VALUE, so we recreate the enum.

-- Rename the type temporarily to free the name.
ALTER TYPE "PartnerApplicationStatus" RENAME TO "PartnerApplicationStatus_old";

-- Create the new enum with all 10 values.
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

-- Migrate the column to the new type (USING cast handles the identical names).
ALTER TABLE "PartnerApplication"
  ALTER COLUMN status TYPE "PartnerApplicationStatus"
  USING status::text::"PartnerApplicationStatus";

-- Drop the old enum.
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
