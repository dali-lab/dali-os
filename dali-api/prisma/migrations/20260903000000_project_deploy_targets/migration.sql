-- Deployment targets for a project's Deployment page: which Fly app's machines
-- and which Neon project's branches to read. Both are nullable with no default,
-- so this is additive and non-data-losing — every existing project simply has
-- no target set, and its Deployment page shows the "not linked yet" state
-- until a lead fills one in on the project detail page.
ALTER TABLE "Project" ADD COLUMN "flyAppName" TEXT;
ALTER TABLE "Project" ADD COLUMN "neonProjectId" TEXT;
