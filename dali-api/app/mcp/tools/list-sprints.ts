// MCP `list_sprints` — a project's sprints. Any authenticated member can read.
//
// Sprints are not stored rows: a sprint is a fixed one-week band anchored to
// each term the project runs (Sprint 1..N per term), the same grid the project
// timeline and task board draw. A task belongs to a sprint by its dates. This
// tool computes that grid so callers can see the sprint calendar.

import { prisma } from "~/lib/db";
import { DAY, SPRINT_DAYS, utcDayOf, localTodayUtcDay } from "~/projects/lib/timeline-days";

const SPRINT_STEP = SPRINT_DAYS * DAY;

export const LIST_SPRINTS_TOOL = {
  name: "list_sprints",
  description:
    "List a project's sprints. Sprints are fixed one-week bands anchored to each term the project runs (Sprint 1..N per term); a task belongs to a sprint by its dates rather than an assignment. Read-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectId: { type: "string", minLength: 1 },
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:read" as const,
};

type Input = { projectId: string };

export async function runListSprints(_callerId: string, input: Input) {
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      projectTerms: {
        select: {
          term: { select: { code: true, startDate: true, endDate: true, sortKey: true } },
        },
      },
    },
  });
  const terms = (project?.projectTerms ?? [])
    .map((pt) => pt.term)
    .sort((a, b) => a.sortKey - b.sortKey);

  const today = localTodayUtcDay(new Date());
  const sprints: {
    term: string;
    number: number;
    label: string;
    startsAt: string;
    endsAt: string;
    phase: "past" | "current" | "upcoming";
  }[] = [];
  for (const t of terms) {
    const start = utcDayOf(t.startDate.toISOString());
    const end = utcDayOf(t.endDate.toISOString());
    let n = 0;
    for (let key = start; key <= end; key += SPRINT_STEP, n++) {
      const bandEnd = Math.min(key + SPRINT_STEP - DAY, end);
      const phase =
        today >= key && today <= bandEnd ? "current" : today > bandEnd ? "past" : "upcoming";
      sprints.push({
        term: t.code,
        number: n + 1,
        label: `Sprint ${n + 1}`,
        startsAt: new Date(key).toISOString(),
        endsAt: new Date(bandEnd + DAY).toISOString(),
        phase,
      });
    }
  }

  return { sprints };
}
