import type { Route } from "./+types/api.epics.$id.stories";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/epics/:id/stories
//
// Create a user story under an epic. Body: { title, notes?, status?, startsAt?,
// endsAt?, successMetric?, acceptanceCriteria?, category?, priority? }.
// status defaults to "Todo"; position is appended after the current max.
// Dependencies aren't set here — a brand-new story has nothing to point at yet;
// they're added via POST /api/stories/:id.
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

type Body = {
  title: string;
  notes?: string | null;
  status?: string;
  // Date-only strings (YYYY-MM-DD) or null. Stored as UTC midnight so the
  // timeline's UTC day math lands on the column the user picked.
  startsAt?: string | null;
  endsAt?: string | null;
  successMetric?: string | null;
  acceptanceCriteria?: string | null;
  category?: string | null;
  priority?: string | null;
};

function isNullableString(v: unknown): boolean {
  return v === undefined || v === null || typeof v === "string";
}

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.notes != null && typeof o.notes !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (!isNullableString(o.startsAt)) return false;
  if (!isNullableString(o.endsAt)) return false;
  if (!isNullableString(o.successMetric)) return false;
  if (!isNullableString(o.acceptanceCriteria)) return false;
  if (!isNullableString(o.category)) return false;
  if (!isNullableString(o.priority)) return false;
  return true;
}

// Empty/whitespace → null, so a blank optional field clears rather than stores "".
function normText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

// Date-only input → UTC midnight, matching how sprint/epic dates are stored.
function parseDay(v: string | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const epicId = params.id!;
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { id: true, projectId: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, epic.projectId);
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

  const last = await prisma.userStory.findFirst({
    where: { epicId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  if (body.priority != null && body.priority !== "" && !isStoryPriority(body.priority)) {
    return withCors(request, Response.json({ error: "Invalid priority" }, { status: 400 }));
  }
  for (const key of ["startsAt", "endsAt"] as const) {
    if (body[key] != null && body[key] !== "" && !parseDay(body[key])) {
      return withCors(request, Response.json({ error: `Invalid ${key}` }, { status: 400 }));
    }
  }

  const story = await prisma.userStory.create({
    data: {
      epicId,
      title,
      notes: normText(body.notes),
      status,
      position,
      startsAt: parseDay(body.startsAt),
      endsAt: parseDay(body.endsAt),
      successMetric: normText(body.successMetric),
      acceptanceCriteria: normText(body.acceptanceCriteria),
      priority:
        body.priority != null && body.priority !== ""
          ? (body.priority as StoryPriority)
          : null,
      category: normText(body.category),
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: story.id }));
}
