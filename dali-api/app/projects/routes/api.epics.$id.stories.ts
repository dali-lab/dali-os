import type { Route } from "./+types/api.epics.$id.stories";
import { prisma } from "~/lib/db";
import { requireCore } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/epics/:id/stories
//
// Create a user story under an epic. Body: { title, notes?, status? }.
// status defaults to "Todo"; position is appended after the current max.
// Same permission model as epic edit (isCore === Admin || Core).

const STORY_STATUSES = ["Todo", "InProgress", "Done"] as const;
type StoryStatus = (typeof STORY_STATUSES)[number];
function isStoryStatus(x: unknown): x is StoryStatus {
  return typeof x === "string" && (STORY_STATUSES as readonly string[]).includes(x);
}

type Body = {
  title: string;
  notes?: string | null;
  status?: string;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.notes != null && typeof o.notes !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const title = body.title.trim();
  if (!title) {
    return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
  }

  const status = body.status ?? "Todo";
  if (!isStoryStatus(status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const epicId = params.id!;
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { id: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }

  const last = await prisma.userStory.findFirst({
    where: { epicId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const notes = body.notes?.trim() ?? "";
  const story = await prisma.userStory.create({
    data: {
      epicId,
      title,
      notes: notes === "" ? null : notes,
      status,
      position,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: story.id }));
}
