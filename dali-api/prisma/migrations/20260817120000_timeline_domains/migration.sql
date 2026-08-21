-- Per-term domain vocabulary for the lab term timeline (/milestones). Until
-- now the four lanes were hardcoded in app/lib/term-timeline.ts; Core can now
-- add, rename, recolour and remove them from the page's edit mode.
--
-- Additive: TimelineLane.domainKey keeps pointing at these keys, and existing
-- terms are backfilled with the four seeded domains below so nothing changes
-- for a timeline that has never been edited.

CREATE TABLE "TimelineDomain" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TimelineDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimelineDomain_termId_key_key" ON "TimelineDomain"("termId", "key");

ALTER TABLE "TimelineDomain" ADD CONSTRAINT "TimelineDomain_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: any term that already has a seeded timeline gets the four domains
-- its lanes were written against.
INSERT INTO "TimelineDomain" ("id", "termId", "key", "name", "color", "position")
SELECT gen_random_uuid()::text, t."termId", d."key", d."name", d."color", d."position"
FROM (SELECT DISTINCT "termId" FROM "TimelineWeek") t
CROSS JOIN (
    VALUES
        ('pm', 'Product Mgmt', '#1E5779', 0),
        ('design', 'UI / UX Design', '#FFD461', 1),
        ('dev', 'Fullstack Dev', '#00ADAB', 2),
        ('data', 'Data / ML', '#509C81', 3)
) AS d("key", "name", "color", "position");
