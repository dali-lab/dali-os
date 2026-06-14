import type { Route } from "./+types/api.projects.$id.epics";
import { prisma } from "~/lib/db";
import { requireCore } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/:id/epics
//
// Create an epic on a project. Body:
//   { title, status?, targetTermId?, startsAt?, endsAt? }
// status defaults to "Open"; position is appended after the current max.
// startsAt/endsAt are optional ISO strings (nullable on the model); if both
// are given, endsAt must be after startsAt.
// Same permission model as project edit (isCore === Admin || Core).

const EPIC_STATUSES = ["Open", "InProgress", "Done", "Cancelled"] as const;
type EpicStatus = (typeof EPIC_STATUSES)[number];
function isEpicStatus(x: unknown): x is EpicStatus {
  return typeof x === "string" && (EPIC_STATUSES as readonly string[]).includes(x);
}

type Body = {
  title: string;
  status?: string;
  targetTermId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.title !== "string") return false;
  if (o.status !== undefined && typeof o.status !== "string") return false;
  if (o.targetTermId != null && typeof o.targetTermId !== "string") return false;
  if (o.startsAt != null && typeof o.startsAt !== "string") return false;
  if (o.endsAt != null && typeof o.endsAt !== "string") return false;
  return true;
}

// Parse an optional ISO date field. Returns undefined when absent/null,
// a Date when valid, or the string "invalid" when present but unparseable.
function parseOptionalDate(v: string | null | undefined): Date | undefined | "invalid" {
  if (v == null) return undefined;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d : "invalid";
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

  const status = body.status ?? "Open";
  if (!isEpicStatus(status)) {
    return withCors(request, Response.json({ error: "Invalid status" }, { status: 400 }));
  }

  const startsAt = parseOptionalDate(body.startsAt);
  const endsAt = parseOptionalDate(body.endsAt);
  if (startsAt === "invalid" || endsAt === "invalid") {
    return withCors(request, Response.json({ error: "Invalid dates" }, { status: 400 }));
  }
  if (startsAt && endsAt && endsAt <= startsAt) {
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

  const last = await prisma.epic.findFirst({
    where: { projectId: params.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const epic = await prisma.epic.create({
    data: {
      projectId: params.id,
      title,
      status,
      position,
      targetTermId: body.targetTermId ?? null,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: epic.id }));
}
