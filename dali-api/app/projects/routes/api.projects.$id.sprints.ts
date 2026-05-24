import type { Route } from "./+types/api.projects.$id.sprints";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/:id/sprints
//
// Create a sprint. Body: { name, startsAt, endsAt, status?, epicId? }.
// status defaults to "Planned". Dates are ISO strings; closesAt must be
// after startsAt (mirrors api.staffing.cycles date validation).

const SPRINT_STATUSES = ["Planned", "Active", "Closed"] as const;
type SprintStatus = (typeof SPRINT_STATUSES)[number];
function isSprintStatus(x: unknown): x is SprintStatus {
  return typeof x === "string" && (SPRINT_STATUSES as readonly string[]).includes(x);
}

type Body = {
  name: string;
  startsAt: string;
  endsAt: string;
  status?: string;
  epicId?: string | null;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string") return false;
  if (typeof o.startsAt !== "string") return false;
  if (typeof o.endsAt !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.epicId != null && typeof o.epicId !== "string") return false;
  return true;
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
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

  const name = body.name.trim();
  if (!name) {
    return withCors(request, Response.json({ error: "Name is required" }, { status: 400 }));
  }

  const status = body.status ?? "Planned";
  if (!isSprintStatus(status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    return withCors(request, Response.json({ error: "Invalid dates" }, { status: 400 }));
  }
  if (endsAt <= startsAt) {
    return withCors(
      request,
      Response.json({ error: "End date must be after start date" }, { status: 400 }),
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { id: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  const sprint = await prisma.sprint.create({
    data: {
      projectId: params.id,
      name,
      startsAt,
      endsAt,
      status,
      epicId: body.epicId ?? null,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: sprint.id }));
}
