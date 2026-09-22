-- Recordings attach to any collaborative document, keyed by its collab room
-- name, not only to meeting-note pages. The table is new and holds only
-- short-lived rows, so the rename touches no real data.
ALTER TABLE "MeetingRecording" RENAME COLUMN "pageId" TO "documentName";
