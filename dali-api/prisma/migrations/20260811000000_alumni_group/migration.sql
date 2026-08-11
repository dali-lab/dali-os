-- Singleton "Alumni" system group: resolved at query time to every DALIMember
-- whose membershipStatus is Alumni. The symmetric counterpart to the "whole
-- lab" (Active members) announcement audience — pick both to reach everyone.
-- No audience targeted alumni before this.
INSERT INTO "GroupDefinition" ("id", "name", "type", "dynamicQuery", "staticMemberIds", "systemKey", "createdAt")
VALUES (
    'grp_alumni',
    'Alumni',
    'Dynamic',
    'alumni',
    ARRAY[]::text[],
    'alumni',
    CURRENT_TIMESTAMP
)
ON CONFLICT ("systemKey") DO NOTHING;
