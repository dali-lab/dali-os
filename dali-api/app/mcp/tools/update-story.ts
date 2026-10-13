// MCP `update_story` — Core or project member. Mirrors api.stories.$id POST.

import { prisma } from "~/lib/db";
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


export const UPDATE_STORY_TOOL = {
  name: "update_story",
  description:
    "Edit a user story — a requirement inside an epic, a sibling of its tasks (title, notes, status, priority, successMetric, acceptanceCriteria, category). Stories have no dates and never enter sprints. Requires Core or project-member access. Empty string clears nullable text fields; omit a field to leave it unchanged.",
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
  priority?: string;
  successMetric?: string;
  acceptanceCriteria?: string;
  category?: string;
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
  if (Object.keys(data).length === 0) {
    return { ok: true, storyId: input.storyId, noop: true };
  }
  await prisma.userStory.update({ where: { id: input.storyId }, data });
  return { ok: true, storyId: input.storyId };
}
