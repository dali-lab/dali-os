-- The project meeting folders drop "assets" from their names: the folder holds
-- every team / partner meeting, so it reads as "Team meetings", not "Team
-- meeting assets". FOLDER_SLOTS (app/lib/bindings.server.ts) only names the
-- folders it creates, so folders already provisioned keep the old title until
-- they're renamed here.
--
-- Scoped to folders still carrying the exact old default. These are ordinary,
-- editable pages, so anyone who renamed theirs keeps their own name.
UPDATE "Page" p
SET "title" = 'Team meetings', "updatedAt" = now()
FROM "ProcessFolderBinding" b
WHERE b."folderPageId" = p."id"
  AND b."processType" = 'Project'
  AND b."purpose" = 'meeting-notes-team'
  AND p."title" = 'Team meeting assets';

UPDATE "Page" p
SET "title" = 'Partner meetings', "updatedAt" = now()
FROM "ProcessFolderBinding" b
WHERE b."folderPageId" = p."id"
  AND b."processType" = 'Project'
  AND b."purpose" = 'meeting-notes-partner'
  AND p."title" = 'Partner meeting assets';
