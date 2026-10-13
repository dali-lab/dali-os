// MCP `list_sprints` — a project's weekly sprints. Any authenticated member can read.

import { ensureSprints, loadSprintAnchors, loadSprintModels } from "~/projects/lib/sprints.server";
import { sprintStatus, sprintDays, WEEKDAY_LABELS } from "~/projects/lib/sprints";
import { labTodayUtcDay } from "~/lib/timezone";

export const LIST_SPRINTS_TOOL = {
  name: "list_sprints",
  description:
    "List a project's sprints: strict one-week windows per term, starting on the team's anchor weekday. Each task sits in exactly one sprint or the backlog; pass a sprint's `id` to create_task/update_task to schedule work. Closed sprints carry their snapshot (planned/completed/carried over). Read-only.",
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
  await ensureSprints(input.projectId);
  const [sprints, anchors] = await Promise.all([
    loadSprintModels(input.projectId),
    loadSprintAnchors(input.projectId),
  ]);
  const today = labTodayUtcDay(new Date());
  return {
    anchors: anchors.map((a) => ({ term: a.termCode, startsOn: WEEKDAY_LABELS[a.anchorDay] })),
    sprints: sprints.map((s) => ({
      id: s.id,
      term: s.termCode,
      number: s.number,
      label: `Sprint ${s.number}`,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      phase: sprintStatus(sprintDays(s), today).toLowerCase(),
      ...(s.closed
        ? {
            planned: s.plannedCount,
            completed: s.completedCount,
            carriedOver: s.carriedOverCount,
          }
        : {}),
    })),
  };
}
