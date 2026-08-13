-- Lab term timeline (/milestones): ten weeks per term, seeded from the static
-- defaults on first open and edited in place by Core. Additive — no existing
-- table is touched.

CREATE TABLE "TimelineWeek" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "weekIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "dates" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "imageKey" TEXT,
    "imageAlt" TEXT,
    "resources" TEXT[],
    "format" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimelineWeek_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimelineMilestone" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "labWide" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,

    CONSTRAINT "TimelineMilestone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TimelineLane" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "domainKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "deliverables" TEXT[],
    "challenge" TEXT NOT NULL,

    CONSTRAINT "TimelineLane_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimelineWeek_termId_weekIndex_key" ON "TimelineWeek"("termId", "weekIndex");

CREATE INDEX "TimelineMilestone_weekId_idx" ON "TimelineMilestone"("weekId");

CREATE UNIQUE INDEX "TimelineLane_weekId_domainKey_key" ON "TimelineLane"("weekId", "domainKey");

ALTER TABLE "TimelineWeek" ADD CONSTRAINT "TimelineWeek_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimelineMilestone" ADD CONSTRAINT "TimelineMilestone_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "TimelineWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TimelineLane" ADD CONSTRAINT "TimelineLane_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "TimelineWeek"("id") ON DELETE CASCADE ON UPDATE CASCADE;
