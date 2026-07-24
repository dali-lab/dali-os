// MCP `update_story` — Core or project member. Mirrors api.stories.$id POST.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];

export const UPDATE_STORY_TOOL = {
  name: "update_story",
  description:
    "Edit a user story (title, notes, status). Requires Core or project-member access. Empty string clears notes.",
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

  const data: { title?: string; notes?: string | null; status?: StoryStatus } = {};

  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (!trimmed) throw new UpdateStoryError("Title is required", 400);
    data.title = trimmed;
  }
  if (input.notes !== undefined) {
    const trimmed = input.notes.trim();
    data.notes = trimmed === "" ? null : trimmed;
  }
  if (input.status !== undefined) data.status = input.status;

  if (Object.keys(data).length === 0) {
    return { ok: true, storyId: input.storyId, noop: true };
  }

  await prisma.userStory.update({ where: { id: input.storyId }, data });
  return { ok: true, storyId: input.storyId };
}
