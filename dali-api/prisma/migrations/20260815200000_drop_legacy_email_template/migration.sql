-- Drop the dead LegacyEmailTemplate table and its EmailTemplateType enum.
-- No application code reads or writes it: every email path now uses the
-- versioned EmailTemplate / EmailTemplateVersion system, bound per cycle via
-- CycleDecisionEmail / CycleNotificationEmail (and per offering via
-- EducationDecisionEmail). Legacy rows were already forward-migrated into
-- EmailTemplate in 20260426170000_email_template_rubric_pattern, so this only
-- removes the now-orphaned table — no live data depends on it.
DROP TABLE "LegacyEmailTemplate";
DROP TYPE "EmailTemplateType";
