import type { Route } from "./+types/api.tasks.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// PATCH /api/tasks/:id
//
// Edit fields on an existing task that aren't covered by the move endpoint.
// Today this is only `dueAt`; status/position changes still go through
// /api/tasks/:id/move so its column-rebalance logic stays unified. Body is a
// partial — only present fields are written. Permission model mirrors task
// creation (isHiringLead === Admin || Core).

type Body = {
  // ISO timestamp to set, or null to clear the deadline. Absent = no change.
  dueAt?: string | null;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.dueAt !== undefined && o.dueAt !== null && typeof o.dueAt !== "string") {
    return false;
  }
  return true;
}

function parseDueAt(raw: string | null | undefined): Date | null | "invalid" {
  if (raw === undefined) return "invalid"; // shouldn't be called without a key
  if (raw === null || raw === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "invalid";
  return d;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "PATCH") {
    return withCors(
      request,
      Response.json({ error: "Method not allowed" }, { status: 405 }),
    );
  }
  if (!(await isHiringLead(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!task) {
    return withCors(request, Response.json({ error: "Task not found" }, { status: 404 }));
  }

  // Build a partial update: a key being present (even null) is a write; an
  // absent key is a no-op. Right now there's only `dueAt`; more fields slot
  // in here as the edit surface grows.
  const data: { dueAt?: Date | null } = {};
  if ("dueAt" in body) {
    const parsed = parseDueAt(body.dueAt);
    if (parsed === "invalid") {
      return withCors(request, Response.json({ error: "Invalid dueAt" }, { status: 400 }));
    }
    data.dueAt = parsed;
  }

  if (Object.keys(data).length === 0) {
    return withCors(request, Response.json({ ok: true }));
  }

  await prisma.task.update({ where: { id: params.id }, data });
  return withCors(request, Response.json({ ok: true }));
}
