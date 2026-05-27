-- Convert PartnerApplicationDomain.expectedChallenges from free text to a
-- ProseMirror JSON document. Existing rows are wrapped into a single-paragraph
-- doc so the new RichTextViewer can render them unchanged; empty/whitespace
-- values become NULL.

ALTER TABLE "PartnerApplicationDomain"
ALTER COLUMN "expectedChallenges" TYPE JSONB
USING (
  CASE
    WHEN "expectedChallenges" IS NULL OR btrim("expectedChallenges") = '' THEN NULL
    ELSE jsonb_build_object(
      'type', 'doc',
      'content', jsonb_build_array(
        jsonb_build_object(
          'type', 'paragraph',
          'content', jsonb_build_array(
            jsonb_build_object('type', 'text', 'text', "expectedChallenges")
          )
        )
      )
    )
  END
);
