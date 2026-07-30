-- Data-only migration: create and bind the lab-editable partner application
-- form so /partner/apply has its qualitative questions on every environment,
-- not just locally-seeded databases.
--
-- prisma/seed.ts creates the same form (same id) for local dev, but the seed
-- never runs against staging/prod — so those environments had a null
-- PartnerApplicationFormBinding and the apply page rendered only its built-in
-- structured fields (title / target terms / per-domain scope), with no form
-- visible under /forms. This backfills it.
--
-- Every step is guarded so re-running is a no-op and an operator's own choices
-- are never overwritten:
--   * the form is attributed to the longest-standing Admin; on a database with
--     no AdminMembership rows (a fresh local DB, where migrations run before
--     the seed) all three inserts select zero rows and the seed does the work.
--   * the version is only written when the form has none, so later edits made
--     in the Forms UI (which append a new version) survive.
--   * the binding is only written when NOTHING is currently bound, so a form
--     Core deliberately bound from /partners/applications is left alone.

-- The form itself. Published with a public token because loadApplicationForm
-- resolves the binding through loadPublicForm, which requires both. `listed`
-- stays false (its column default): partners reach this through /partner/apply,
-- so it should not surface in members' "Forms for you".
INSERT INTO "Form" ("id", "name", "createdAt", "updatedAt", "createdById", "published", "publicToken")
SELECT
    'form-partner-application',
    'Partner application questions',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    a."userId",
    true,
    '5b9dd21b7205ba8be728de7c60889b87cefdd70231c7417f'
FROM "AdminMembership" a
ORDER BY a."grantedAt" ASC
LIMIT 1
ON CONFLICT ("id") DO NOTHING;

-- Version 1. Only qualitative questions live here: title, target terms, and
-- per-domain scope stay as built-in fields on /partner/apply because they write
-- relations (PartnerApplication.title, PartnerApplicationTargetTerm,
-- PartnerApplicationDomain) that the promote-to-project flow turns into the
-- Project's name, term, and ProjectRoleRequest slots.
INSERT INTO "FormVersion" ("id", "createdAt", "versionNumber", "questions", "intro", "formId", "createdById")
SELECT
    'formver-partner-application-1',
    CURRENT_TIMESTAMP,
    1,
    '[
      {
        "key": "pitch",
        "type": "textarea",
        "required": false,
        "data": {
          "label": "Short pitch",
          "description": "What problem are you trying to solve, and for whom?"
        }
      },
      {
        "key": "success",
        "type": "textarea",
        "required": false,
        "data": {
          "label": "What does success look like?",
          "description": "A term from now, what would make you glad you worked with the lab?"
        }
      },
      {
        "key": "users",
        "type": "textarea",
        "required": false,
        "data": {
          "label": "Who will use what we build?",
          "description": "Roughly how many people, and in what setting?"
        }
      },
      {
        "key": "existing_work",
        "type": "textarea",
        "required": false,
        "data": {
          "label": "What exists today?",
          "description": "Any research, designs, or a codebase we would be building on rather than starting from scratch."
        }
      }
    ]'::jsonb,
    NULL,
    f."id",
    f."createdById"
FROM "Form" f
WHERE f."id" = 'form-partner-application'
  AND NOT EXISTS (SELECT 1 FROM "FormVersion" v WHERE v."formId" = f."id")
ON CONFLICT ("id") DO NOTHING;

-- Bind it to /partner/apply, but only when no binding exists at all — the model
-- is a singleton enforced in the app layer (setApplicationFormBinding deletes
-- then creates), so an unconditional insert here could produce a second row.
INSERT INTO "PartnerApplicationFormBinding" ("id", "formId", "updatedById", "updatedAt")
SELECT
    'pafb-partner-application',
    f."id",
    f."createdById",
    CURRENT_TIMESTAMP
FROM "Form" f
WHERE f."id" = 'form-partner-application'
  AND EXISTS (SELECT 1 FROM "FormVersion" v WHERE v."formId" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "PartnerApplicationFormBinding")
ON CONFLICT ("id") DO NOTHING;
