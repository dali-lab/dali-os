// MCP `update_story` — Core or project member. Mirrors api.stories.$id POST.

import { prisma, Prisma } from "~/lib/db";
import { canEditProject } from "./access";

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];

const STORY_PRIORITIES = ["Must", "Should", "Could", "Wont"] as const;
type StoryPriority = (typeof STORY_PRIORITIES)[number];

function isStoryStatus(x: unknown): x is StoryStatus {
  return typeof x === "string" && (STORY_STATUSES as readonly string[]).includes(x);
}

function isStoryPriority(x: unknown): x is StoryPriority {
  return typeof x === "string" && (STORY_PRIORITIES as readonly string[]).includes(x);
}

// Trim a nullable free-text field; empty → null; undefined → unchanged.
function normText(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// Date-only input (YYYY-MM-DD) → UTC midnight, matching the web route.
function parseDay(v: string): Date | null {
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const UPDATE_STORY_TOOL = {
  name: "update_story",
  description:
    "Edit a user story (title, notes, status, dates, priority, successMetric, acceptanceCriteria, category, dependsOn). Requires Core or project-member access. Empty string clears nullable text fields; null clears date fields; omit a field to leave it unchanged.",
  inputSchema: {
    type: "object" as const,
    properties: {
      storyId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      notes: { type: "string", maxLength: 5000 },
      status: {
        type: "string",
        enum: STORY_STATUSES as unknown as string[],
      },
      startsAt: {
        type: "string",
        description:
          "Date-only string (YYYY-MM-DD) or empty string to clear. Stored as UTC midnight.",
      },
      endsAt: {
        type: "string",
        description: "Date-only string (YYYY-MM-DD) or empty string to clear.",
      },
      priority: {
        type: "string",
        enum: [...STORY_PRIORITIES, ""] as string[],
        description:
          "Story priority (Must/Should/Could/Wont). Empty string clears.",
      },
      successMetric: {
        type: "string",
        description: "Success metric text. Empty string clears.",
      },
      acceptanceCriteria: {
        type: "string",
        description: "Acceptance criteria text. Empty string clears.",
      },
      category: {
        type: "string",
        description: "Category label. Empty string clears.",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Full replacement set of story ids this story depends on (waits for). Omit to leave unchanged; empty array clears all dependencies.",
      },
    },
    required: ["storyId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  storyId: string;
  title?: string;
  notes?: string;
  status?: StoryStatus;
  startsAt?: string;
  endsAt?: string;
  priority?: string;
  successMetric?: string;
  acceptanceCriteria?: string;
  category?: string;
  dependsOn?: string[];
};

export class UpdateStoryError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "UpdateStoryError";
  }
}

export async function runUpdateStory(callerId: string, input: Input) {
  const story = await prisma.userStory.findUnique({
    where: { id: input.storyId },
    select: { id: true, epic: { select: { projectId: true } } },
  });
  if (!story) throw new UpdateStoryError("Story not found", 404);

  if (!(await canEditProject(callerId, story.epic.projectId))) {
    throw new UpdateStoryError("Forbidden", 403);
  }

  const data: {
    title?: string;
    notes?: string | null;
    status?: StoryStatus;
    startsAt?: Date | null;
    endsAt?: Date | null;
    priority?: StoryPriority | null;
    successMetric?: string | null;
    acceptanceCriteria?: string | null;
    category?: string | null;
  } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateStoryError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.notes !== undefined) {
    const trimmed = input.notes.trim();
    data.notes = trimmed === "" ? null : trimmed;
  }
  if (input.status !== undefined) {
    if (!isStoryStatus(input.status)) {
      throw new UpdateStoryError("Invalid status", 400);
    }
    data.status = input.status;
  }
  if (input.successMetric !== undefined) data.successMetric = normText(input.successMetric) ?? null;
  if (input.acceptanceCriteria !== undefined)
    data.acceptanceCriteria = normText(input.acceptanceCriteria) ?? null;
  if (input.category !== undefined) data.category = normText(input.category) ?? null;
  if (input.priority !== undefined) {
    if (input.priority === "" || input.priority === null) {
      data.priority = null;
    } else if (isStoryPriority(input.priority)) {
      data.priority = input.priority;
    } else {
      throw new UpdateStoryError("Invalid priority", 400);
    }
  }
  for (const key of ["startsAt", "endsAt"] as const) {
    const raw = input[key];
    if (raw === undefined) continue;
    if (raw === "" || raw === null) {
      data[key] = null;
      continue;
    }
    const parsed = parseDay(raw);
    if (!parsed) {
      throw new UpdateStoryError(`Invalid ${key}`, 400);
    }
    data[key] = parsed;
  }

  const wantsDependencies = Array.isArray(input.dependsOn);
  const hasCoreChanges = Object.keys(data).length > 0;

  if (!hasCoreChanges && !wantsDependencies) {
    return { ok: true, storyId: input.storyId, noop: true };
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (hasCoreChanges) {
    ops.push(prisma.userStory.update({ where: { id: input.storyId }, data }));
  }

  if (wantsDependencies) {
    const ids = [...new Set(input.dependsOn ?? [])].filter(
      (x) => x && x !== input.storyId,
    );
    if (ids.length > 0) {
      const valid = await prisma.userStory.count({
        where: { id: { in: ids }, epic: { projectId: story.epic.projectId } },
      });
      if (valid !== ids.length) {
        throw new UpdateStoryError("Invalid dependency target", 400);
      }
    }
    ops.push(
      prisma.userStoryDependency.deleteMany({ where: { storyId: input.storyId } }),
      ...ids.map((depId) =>
        prisma.userStoryDependency.create({
          data: { storyId: input.storyId, dependsOnStoryId: depId },
        }),
      ),
    );
  }

  await prisma.$transaction(ops);
  return { ok: true, storyId: input.storyId };
}
