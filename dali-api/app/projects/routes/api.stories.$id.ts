import type { Route } from "./+types/api.stories.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/stories/:id  — edit. Body: { title?, notes?, status? }
// DELETE /api/stories/:id  — delete the story.
//
// Same permission model as epic edit (isCore === Admin || Core).

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];
function isStoryStatus(x: unknown): x is StoryStatus {
  return typeof x === "string" && (STORY_STATUSES as readonly string[]).includes(x);
}

type EditBody = {
  title?: string;
  notes?: string | null;
  status?: string;
};

function isEditBody(x: unknown): x is EditBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.title !== undefined && typeof o.title !== "string") return false;
  if (o.notes !== undefined && o.notes !== null && typeof o.notes !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const storyId = params.id!;
  const story = await prisma.userStory.findUnique({
    where: { id: storyId },
    select: { id: true },
  });
  if (!story) {
    return withCors(request, Response.json({ error: "Story not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.userStory.delete({ where: { id: storyId } });
    return withCors(request, Response.json({ ok: true }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isEditBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const data: { title?: string; notes?: string | null; status?: StoryStatus } = {};

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = title;
  }
  if (body.notes !== undefined) {
    const notes = body.notes?.trim() ?? "";
    data.notes = notes === "" ? null : notes;
  }
  if (body.status !== undefined) {
    if (!isStoryStatus(body.status)) {
      return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
    }
    data.status = body.status;
  }

  await prisma.userStory.update({ where: { id: storyId }, data });
  return withCors(request, Response.json({ ok: true }));
}
