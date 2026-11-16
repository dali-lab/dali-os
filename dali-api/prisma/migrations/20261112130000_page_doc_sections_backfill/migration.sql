UPDATE "PageDoc"
SET "sections" = jsonb_build_array(
  jsonb_build_object('id', 'overview', 'title', 'Overview', 'body', "body", 'videoKey', "videoKey")
)
WHERE "sections" IS NULL OR "sections" = '[]'::jsonb;
