import type { Route } from "./+types/api.sprints.$id";
import { prisma } from "~/lib/db";
import { requireCore } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/sprints/:id — edit. Body: { name?, startsAt?, endsAt?, status?, epicId? }
// DELETE /api/sprints/:id — delete. Tasks pointing at this sprint have their
//                           sprintId nulled (back to backlog) so nothing is
//                           orphaned or cascade-deleted.
//
// Same permission model as project edit (isCore === Admin || Core).

const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;
type SprintStatus = (typeof SPRINT_STATUSES)[number];
function isSprintStatus(x: unknown): x is SprintStatus {
  return typeof x === "string" && (SPRINT_STATUSES as readonly string[]).includes(x);
}

type EditBody = {
  name?: string;
  startsAt?: string;
  endsAt?: string;
  status?: string;
  epicId?: string | null;
};

function isEditBody(x: unknown): x is EditBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.name !== undefined && typeof o.name !== "string") return false;
  if (o.startsAt !== undefined && typeof o.startsAt !== "string") return false;
  if (o.endsAt !== undefined && typeof o.endsAt !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.epicId !== undefined && o.epicId !== null && typeof o.epicId !== "string") return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;

  const sprintId = params.id!;
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    select: { id: true, startsAt: true, endsAt: true },
  });
  if (!sprint) {
    return withCors(request, Response.json({ error: "Sprint not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.$transaction([
      prisma.task.updateMany({ where: { sprintId }, data: { sprintId: null } }),
      prisma.sprint.delete({ where: { id: sprintId } }),
    ]);
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
    name?: string;
    startsAt?: Date;
    endsAt?: Date;
    status?: SprintStatus;
    epicId?: string | null;
  } = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return withCors(request, Response.json({ error: "Name is required" }, { status: 400 }));
    }
    data.name = name;
  }
  if (body.status !== undefined) {
    if (!isSprintStatus(body.status)) {
      return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
    }
    data.status = body.status;
  }
  if (body.startsAt !== undefined) {
    const d = new Date(body.startsAt);
    if (!Number.isFinite(d.getTime())) {
      return withCors(request, Response.json({ error: "Invalid start date" }, { status: 400 }));
    }
    data.startsAt = d;
  }
  if (body.endsAt !== undefined) {
    const d = new Date(body.endsAt);
    if (!Number.isFinite(d.getTime())) {
      return withCors(request, Response.json({ error: "Invalid end date" }, { status: 400 }));
    }
    data.endsAt = d;
  }
  if (body.epicId !== undefined) {
    data.epicId = body.epicId;
  }

  // Validate the resulting range against whichever side is being changed,
  // falling back to the stored value for the unchanged side.
  const effStart = data.startsAt ?? sprint.startsAt;
  const effEnd = data.endsAt ?? sprint.endsAt;
  if (effEnd <= effStart) {
    return withCors(
      request,
      Response.json({ error: "End date must be after start date" }, { status: 400 }),
    );
  }

  await prisma.sprint.update({ where: { id: sprintId }, data });
  return withCors(request, Response.json({ ok: true }));
}
