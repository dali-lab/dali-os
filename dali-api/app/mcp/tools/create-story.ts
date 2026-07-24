// MCP `create_story` — Core or project member. Mirrors api.epics.$id.stories.

import { prisma } from "~/lib/db";
import { canEditProject } from "./access";

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];

export const CREATE_STORY_TOOL = {
  name: "create_story",
  description:
    "Create a user story under an epic. Requires Core or project-member access.",
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
  const title = input.title.trim();
  if (!title) throw new CreateStoryError("Title is required", 400);

  const epic = await prisma.epic.findUnique({
    where: { id: input.epicId },
    select: { id: true, projectId: true },
  });
  if (!epic) throw new CreateStoryError("Epic not found", 404);

  if (!(await canEditProject(callerId, epic.projectId))) {
    throw new CreateStoryError("Forbidden", 403);
  }

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
