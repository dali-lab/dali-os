-- One live recording per document. Two people pressing Record on the same
-- meeting note (or one person from two devices) used to produce two rows,
-- two Modal jobs and two transcripts appended to the note. Prisma can't
-- express a partial index, so it lives here in raw SQL (same approach as
-- Interview_activeDomainApplication_key).
--
-- Any existing duplicates are test recordings from the flag-off rollout;
-- all but the newest per document are marked Failed so the index can be
-- created without operator intervention. Their audio is swept by the stale
-- sweep in createRecording / recording-finalizer as usual.
UPDATE "MeetingRecording" r
SET status = 'Failed',
    error = 'Another recording of this note was started later.'
WHERE r.status IN ('Pending', 'Recording', 'Stopped', 'Processing')
  AND EXISTS (
    SELECT 1 FROM "MeetingRecording" newer
    WHERE newer."documentName" = r."documentName"
      AND newer.status IN ('Pending', 'Recording', 'Stopped', 'Processing')
      AND newer."createdAt" > r."createdAt"
  );

CREATE UNIQUE INDEX "MeetingRecording_activeDocument_key"
  ON "MeetingRecording" ("documentName")
  WHERE status IN ('Pending', 'Recording', 'Stopped', 'Processing');
