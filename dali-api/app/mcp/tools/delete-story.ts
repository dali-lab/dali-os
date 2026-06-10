// MCP `delete_story` — Core-only.

import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

export const DELETE_STORY_TOOL = {
  name: "delete_story",
  description: "Delete a user story. Core-only.",
  inputSchema: {
    type: "object" as const,
    properties: {
      storyId: { type: "string", minLength: 1 },
    },
    required: ["storyId"],
    additionalProperties: false,
  },
  requiredScope: "mcp:write" as const,
};

type Input = { storyId: string };

export class DeleteStoryError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteStoryError";
  }
}

export async function runDeleteStory(callerId: string, input: Input) {
  if (!(await isCore(callerId))) {
    throw new DeleteStoryError("Forbidden", 403);
  }

  const story = await prisma.userStory.findUnique({
    where: { id: input.storyId },
    select: { id: true },
  });
  if (!story) throw new DeleteStoryError("Story not found", 404);

  await prisma.userStory.delete({ where: { id: input.storyId } });
  return { ok: true, storyId: input.storyId };
}
