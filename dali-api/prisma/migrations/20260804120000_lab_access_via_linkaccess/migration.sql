-- Lab documents now express their audience through General access
-- (Page.linkAccess), the same control every other workspace uses, replacing the
-- boolean Page.labRestricted. Preserve current behavior before dropping it:
--
--   labRestricted = false ("Everyone in the lab", historically edit) →
--       linkAccess = 'LabMembers', linkPermission = 'Edit'
--   labRestricted = true  ("Only people you add") → already linkAccess =
--       'Restricted' (the column default); nothing to change.
--
-- Guard on linkAccess = 'Restricted' so a lab doc that was already opened to the
-- public keeps its 'Public' setting.
UPDATE "Page"
SET "linkAccess" = 'LabMembers',
    "linkPermission" = 'Edit'
WHERE "workspaceType" = 'Lab'
  AND "labRestricted" = false
  AND "linkAccess" = 'Restricted';

-- Retire the column: audience now lives entirely in linkAccess/linkPermission.
ALTER TABLE "Page" DROP COLUMN "labRestricted";
