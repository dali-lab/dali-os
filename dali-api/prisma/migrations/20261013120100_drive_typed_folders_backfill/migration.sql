-- Drive phase 1a backfills, in their own migration because Postgres cannot use
-- an enum value (PageKind.Notebook) in the transaction that added it.
-- Data-only; no schema change.

-- Backfill: existing meeting notebooks become kind Notebook.
UPDATE "Page" SET "kind" = 'Notebook'
WHERE "notebookKey" IS NOT NULL AND "kind" = 'FreeForm';

-- Backfill: each series' default notebook is the parent of its most recent
-- occurrence note, when that parent is a notebook.
UPDATE "ScheduledMeeting" m
SET "notebookId" = latest."parentPageId"
FROM (
  SELECT DISTINCT ON (note."meetingNoteId")
    note."meetingNoteId",
    note."parentPageId"
  FROM "Page" note
  JOIN "Page" parent ON parent."id" = note."parentPageId"
  WHERE note."meetingNoteId" IS NOT NULL
    AND parent."notebookKey" IS NOT NULL
  ORDER BY note."meetingNoteId", note."meetingOccurrenceStart" DESC NULLS LAST
) latest
WHERE latest."meetingNoteId" = m."id";

-- Backfill: key the hiring and education template forms. The oldest form per
-- name wins when several exist. Names match TEMPLATE_NAME in
-- app/hiring/lib/application-form.server.ts and TEMPLATE_NAMES in
-- app/education/lib/application-form.server.ts.
UPDATE "Form" f
SET "templateKey" = k."templateKey"
FROM (
  SELECT DISTINCT ON (form."name") form."id", keys."templateKey"
  FROM "Form" form
  JOIN (VALUES
    ('Internal Application Template', 'hiring-application-template'),
    ('Miniseries Application Template', 'education-template-miniseries'),
    ('Fellowship Application Template', 'education-template-fellowship'),
    ('Workshop RSVP Template', 'education-template-workshop')
  ) AS keys("name", "templateKey") ON keys."name" = form."name"
  WHERE form."templateKey" IS NULL
  ORDER BY form."name", form."createdAt", form."id"
) k
WHERE f."id" = k."id";
