import type { Route } from "./+types/api.epics.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/epics/:id  — edit. Body: { title?, status?, targetTermId? }
// DELETE /api/epics/:id  — delete. Sprints/tasks pointing at this epic have
//                          their epicId nulled (both are nullable links) so
//                          nothing is orphaned or cascade-deleted.
//
// Same permission model as project edit (isCore === Admin || Core).

const EPIC_STATUSES = ["Backlog", "Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];
function isEpicStatus(x: unknown): x is EpicStatus {
  return typeof x === "string" && (EPIC_STATUSES as readonly string[]).includes(x);
}

type EditBody = {
  title?: string;
  description?: string | null;
  status?: string;
  targetTermId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

function isEditBody(x: unknown): x is EditBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.title !== undefined && typeof o.title !== "string") return false;
  if (o.description !== undefined && o.description !== null && typeof o.description !== "string")
    return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.targetTermId !== undefined && o.targetTermId !== null && typeof o.targetTermId !== "string")
    return false;
  if (o.startsAt !== undefined && o.startsAt !== null && typeof o.startsAt !== "string")
    return false;
  if (o.endsAt !== undefined && o.endsAt !== null && typeof o.endsAt !== "string")
    return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const epicId = params.id!;
  const epic = await prisma.epic.findUnique({
    where: { id: epicId },
    select: { id: true, startsAt: true, endsAt: true, projectId: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, epic.projectId);
  if (!gate.ok) return gate.response;

  if (request.method === "DELETE") {
    await prisma.$transaction([
      prisma.sprint.updateMany({ where: { epicId }, data: { epicId: null } }),
      prisma.task.updateMany({ where: { epicId }, data: { epicId: null } }),
      prisma.epic.delete({ where: { id: epicId } }),
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
    title?: string;
    description?: string | null;
    status?: EpicStatus;
    targetTermId?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {};

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = title;
  }
  if (body.description !== undefined) {
    // Empty string clears the description back to null.
    const desc = body.description?.trim() ?? "";
    data.description = desc === "" ? null : desc;
  }
  if (body.status !== undefined) {
    if (!isEpicStatus(body.status)) {
      return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
    }
    data.status = body.status;
  }
  if (body.targetTermId !== undefined) {
    data.targetTermId = body.targetTermId;
  }
  if (body.startsAt !== undefined) {
    if (body.startsAt === null) {
      data.startsAt = null;
    } else {
      const d = new Date(body.startsAt);
      if (!Number.isFinite(d.getTime())) {
        return withCors(request, Response.json({ error: "Invalid start date" }, { status: 400 }));
      }
      data.startsAt = d;
    }
  }
  if (body.endsAt !== undefined) {
    if (body.endsAt === null) {
      data.endsAt = null;
    } else {
      const d = new Date(body.endsAt);
      if (!Number.isFinite(d.getTime())) {
        return withCors(request, Response.json({ error: "Invalid end date" }, { status: 400 }));
      }
      data.endsAt = d;
    }
  }

  // Validate the resulting range: use the incoming value where provided,
  // otherwise the stored value. Only enforce when both ends resolve to a
  // date (either side may legitimately be null).
  const effStart = data.startsAt !== undefined ? data.startsAt : epic.startsAt;
  const effEnd = data.endsAt !== undefined ? data.endsAt : epic.endsAt;
  if (effStart && effEnd && effEnd <= effStart) {
    return withCors(
      request,
      Response.json({ error: "End date must be after start date" }, { status: 400 }),
    );
  }

  await prisma.epic.update({ where: { id: epicId }, data });
  return withCors(request, Response.json({ ok: true }));
}
