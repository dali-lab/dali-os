// MCP `create_story` — Core-only. Mirrors api.epics.$id.stories.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];

export const CREATE_STORY_TOOL = {
  name: "create_story",
  description: "Create a user story under an epic. Core-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      epicId: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1, maxLength: 500 },
      notes: { type: "string", maxLength: 5000 },
      status: {
        type: "string",
        enum: STORY_STATUSES as unknown as string[],
        description: "Defaults to 'Todo'.",
      },
    },
    required: ["epicId", "title"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = {
  epicId: string;
  title: string;
  notes?: string;
  status?: StoryStatus;
};

export class CreateStoryError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "CreateStoryError";
  }
}

export async function runCreateStory(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new CreateStoryError("Forbidden", 403);
  }

  const title = input.title.trim();
  if (!title) throw new CreateStoryError("Title is required", 400);

  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true },
  });
  if (!epic) throw new CreateStoryError("Epic not found", 404);

  const last = await prisma.userStory.findFirst({
    where: { epicId: input.epicId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const notes = input.notes?.trim() ?? "";
  const story = await prisma.userStory.create({
    data: {
      epicId: input.epicId,
      title,
      notes: notes === "" ? null : notes,
      status: input.status ?? "Todo",
      position,
    },
    select: { id: true },
  });

  return { id: story.id };
}
