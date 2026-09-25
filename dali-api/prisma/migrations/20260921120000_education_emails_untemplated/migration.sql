-- Education's decision emails stop being template bindings.
--
-- Before: each offering could bind an EmailTemplateVersion per application
-- status, and an unbound status fell back to hard-coded copy in
-- app/education/lib/notifications.server.ts. After: one editable email per
-- slot, shared by every course, with no versions — the same shape hiring
-- moved to in HiringEmail. The four rows below carry the old built-in copy
-- forward with {{domain}} standing in for the course title, so what sends
-- today keeps sending after the migration.

CREATE TABLE "EducationEmail" (
    "slot" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "EducationEmail_pkey" PRIMARY KEY ("slot")
);

ALTER TABLE "EducationEmail" ADD CONSTRAINT "EducationEmail_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "EducationEmail" ("slot", "subject", "body", "updatedAt") VALUES
    ('decision:Approved',
     'You''re in: {{domain}}',
     'Your spot in {{domain}} is confirmed. Open the course hub for sessions and materials.',
     NOW()),
    ('decision:Waitlisted',
     'Waitlisted for {{domain}}',
     '{{domain}} is currently full. You''re on the waitlist — if a seat opens you''ll be enrolled automatically.',
     NOW()),
    ('decision:Rejected',
     'Update on {{domain}}',
     'Your application to {{domain}} wasn''t accepted this time. We''d love to see you at a future offering.',
     NOW()),
    ('decision:Withdrawn',
     'Withdrawn from {{domain}}',
     'You''ve been withdrawn from {{domain}}.',
     NOW());

-- Per-offering bindings are gone. Nothing is migrated out of them: a bound
-- template was one of the rows above in all but name, and the shared copy now
-- covers every course.
DROP TABLE "EducationDecisionEmail";
