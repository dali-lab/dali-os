-- Seed one "Created" activity per existing partner opportunity so the new
-- timeline feed isn't empty for pre-existing rows. Past status transitions
-- predate the activity log and are unrecoverable — feeds simply start at
-- "Created". Deterministic id + NOT EXISTS guard make this idempotent.
INSERT INTO "PartnerActivity" ("id", "createdAt", "applicationId", "actorUserId", "type", "body", "metadata")
SELECT
    'pact_created_' || a."id",
    a."createdAt",
    a."id",
    NULL,
    'Created',
    NULL,
    NULL
FROM "PartnerApplication" a
WHERE NOT EXISTS (
    SELECT 1 FROM "PartnerActivity" pa
    WHERE pa."applicationId" = a."id" AND pa."type" = 'Created'
)
ON CONFLICT ("id") DO NOTHING;
