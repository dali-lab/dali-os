-- Vaultwarden project integration: a per-project org GROUP id (backfilled by the
-- "Set up Vaultwarden group" finalize automation / sync when null) and a
-- COLLECTION id (operator-pasted; the group is granted access to it). Both
-- nullable with no default → metadata-only adds, no table rewrite.
ALTER TABLE "Project" ADD COLUMN "vaultwardenGroupId" TEXT;
ALTER TABLE "Project" ADD COLUMN "vaultwardenCollectionId" TEXT;
