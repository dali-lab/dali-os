// MCP `delete_story` — Core or project member.

import { prisma } from "~/lib/db.server";
import { canEditProject } from "./access";

export const DELETE_STORY_PROPERTIES = {
  storyId: { type: "string", minLength: 1 },
};

export const DELETE_STORY_REQUIRED = ["storyId"];

type Input = { storyId: string };

export class DeleteStoryError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "DeleteStoryError";
  }
}

export async function runDeleteStory(callerId: string, input: Input) {
  const story = await prisma.userStory.findUnique({
    where: { id: input.storyId },
    select: { id: true, epic: { select: { projectId: true } } },
  });
  if (!story) throw new DeleteStoryError("Story not found", 404);

  if (!(await canEditProject(callerId, story.epic.projectId))) {
    throw new DeleteStoryError("Forbidden", 403);
  }

  await prisma.userStory.delete({ where: { id: input.storyId } });
  return { ok: true, storyId: input.storyId };
}
