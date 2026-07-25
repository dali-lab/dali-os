import type { Route } from "./+types/api.stories.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
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

const STORY_PRIORITIES = ["Must", "Should", "Could", "Wont"] as const;
type StoryPriority = (typeof STORY_PRIORITIES)[number];
function isStoryPriority(x: unknown): x is StoryPriority {
  return typeof x === "string" && (STORY_PRIORITIES as readonly string[]).includes(x);
}

// Trim a nullable free-text field; empty → null; undefined → leave unchanged.
function normText(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

type EditBody = {
  title?: string;
  notes?: string | null;
  status?: string;
  successMetric?: string | null;
  acceptanceCriteria?: string | null;
  category?: string | null;
  priority?: string | null;
};

function isNullableString(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "string";
}

function isEditBody(x: unknown): x is EditBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.title !== undefined && typeof o.title !== "string") return false;
  if (o.notes !== undefined && o.notes !== null && typeof o.notes !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (!isNullableString(o.successMetric)) return false;
  if (!isNullableString(o.acceptanceCriteria)) return false;
  if (!isNullableString(o.category)) return false;
  if (!isNullableString(o.priority)) return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const storyId = params.id!;
  const story = await prisma.userStory.findUnique({
    where: { id: storyId },
    select: { id: true, epic: { select: { projectId: true } } },
  });
  if (!story) {
    return withCors(request, Response.json({ error: "Story not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, story.epic.projectId);
  if (!gate.ok) return gate.response;

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

  const data: {
    title?: string;
    notes?: string | null;
    status?: StoryStatus;
    successMetric?: string | null;
    acceptanceCriteria?: string | null;
    category?: string | null;
    priority?: StoryPriority | null;
  } = {};

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
  if (body.successMetric !== undefined) data.successMetric = normText(body.successMetric);
  if (body.acceptanceCriteria !== undefined)
    data.acceptanceCriteria = normText(body.acceptanceCriteria);
  if (body.category !== undefined) data.category = normText(body.category);
  if (body.priority !== undefined) {
    if (body.priority === null || body.priority === "") {
      data.priority = null;
    } else if (isStoryPriority(body.priority)) {
      data.priority = body.priority;
    } else {
      return withCors(request, Response.json({ error: "Invalid priority" }, { status: 400 }));
    }
  }

  await prisma.userStory.update({ where: { id: storyId }, data });
  return withCors(request, Response.json({ ok: true }));
}
