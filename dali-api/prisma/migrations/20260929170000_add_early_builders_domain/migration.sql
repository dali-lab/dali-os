-- Seed the Early builders fellowship program domain.
INSERT INTO "Domain" ("id", "createdAt", "updatedAt", "name", "code", "displayName", "isInternProgram", "isSystem", "active")
VALUES ('domain_early_builders', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'Early builders', 'EarlyBuilders', 'Early builders', true, false, true)
ON CONFLICT ("code") DO NOTHING;
