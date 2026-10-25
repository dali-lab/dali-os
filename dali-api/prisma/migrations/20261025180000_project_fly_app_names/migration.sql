-- Which Fly apps in the (shared) org belong to this DALI project.
ALTER TABLE "Project" ADD COLUMN "flyAppNames" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Keep today's view: each project with Fly configured claims the apps its
-- latest sweep found.
UPDATE "Project" p
SET "flyAppNames" = apps.names
FROM (
  SELECT DISTINCT ON (s."projectId")
    s."projectId",
    ARRAY(SELECT a->>'name' FROM jsonb_array_elements(s.payload->'apps') a WHERE a->>'name' IS NOT NULL) AS names
  FROM "InfraSnapshot" s
  WHERE s.provider = 'fly' AND jsonb_typeof(s.payload->'apps') = 'array'
  ORDER BY s."projectId", s."fetchedAt" DESC
) apps
WHERE apps."projectId" = p.id AND p."flyOrgSlug" IS NOT NULL;
