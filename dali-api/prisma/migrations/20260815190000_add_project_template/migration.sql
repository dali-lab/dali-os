-- Project templates: a reusable, standalone blueprint of a project's structure
-- (epics, sprints as relative day-offsets, tasks + checklists) captured as JSON
-- so a new project can be instantiated pre-populated. No FK to a live project —
-- capture serialises, instantiate rebuilds.
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconEmoji" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "blueprint" JSONB NOT NULL,
    "overviewSourcePageId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectTemplate_isDefault_idx" ON "ProjectTemplate"("isDefault");
