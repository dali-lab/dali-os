import type { Route } from "./+types/api.stories.$id";
import { prisma, Prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/stories/:id  — edit. Body: { title?, notes?, status?, startsAt?,
//                            endsAt?, dependsOn? }
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
  // Date-only strings (YYYY-MM-DD) or null to clear. Stored as UTC midnight so
  // the timeline's UTC day math lands on the column the user picked.
  startsAt?: string | null;
  endsAt?: string | null;
  // Full replacement set of story ids this story depends on (waits for).
  dependsOn?: string[];
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
  if (!isNullableString(o.startsAt)) return false;
  if (!isNullableString(o.endsAt)) return false;
  if (
    o.dependsOn !== undefined &&
    (!Array.isArray(o.dependsOn) || o.dependsOn.some((v) => typeof v !== "string"))
  ) {
    return false;
  }
  return true;
}

// Date-only input → UTC midnight, matching how sprint/epic dates are stored.
function parseDay(v: string): Date | null {
  const d = new Date(`${v.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
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
    startsAt?: Date | null;
    endsAt?: Date | null;
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

  for (const key of ["startsAt", "endsAt"] as const) {
    const raw = body[key];
    if (raw === undefined) continue;
    if (raw === null || raw === "") {
      data[key] = null;
      continue;
    }
    const parsed = parseDay(raw);
    if (!parsed) {
      return withCors(request, Response.json({ error: `Invalid ${key}` }, { status: 400 }));
    }
    data[key] = parsed;
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.userStory.update({ where: { id: storyId }, data }),
  ];

  // Dependencies are replaced wholesale, mirroring the sprint route: each id
  // must be another story in the same project. (Cycles aren't blocked — the
  // arrows are advisory, and the unique index dedupes repeats.)
  if (body.dependsOn !== undefined) {
    const ids = [...new Set(body.dependsOn)].filter((x) => x && x !== storyId);
    if (ids.length > 0) {
      const valid = await prisma.userStory.count({
        where: { id: { in: ids }, epic: { projectId: story.epic.projectId } },
      });
      if (valid !== ids.length) {
        return withCors(
          request,
          Response.json({ error: "Invalid dependency target" }, { status: 400 }),
        );
      }
    }
    ops.push(
      prisma.userStoryDependency.deleteMany({ where: { storyId } }),
      ...ids.map((depId) =>
        prisma.userStoryDependency.create({
          data: { storyId, dependsOnStoryId: depId },
        }),
      ),
    );
  }

  await prisma.$transaction(ops);
  return withCors(request, Response.json({ ok: true }));
}
