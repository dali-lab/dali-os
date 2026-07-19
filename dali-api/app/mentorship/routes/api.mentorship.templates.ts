import type { Route } from "./+types/api.mentorship.templates";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { canViewMentorship } from "../lib/visibility";

// GET  /api/mentorship/templates — list templates (any lab mentor / Core).
//      Lab mentors read so the editor can fetch the default seed; Core gets
//      the same list plus the management UI.
// POST /api/mentorship/templates — create new template. Core only.

type CreateBody = {
  name: string;
  contentJson?: unknown;
  isDefault?: boolean;
};

function isCreateBody(x: unknown): x is CreateBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.name !== "string") return false;
  if (o.isDefault !== undefined && typeof o.isDefault !== "boolean") return false;
  return true;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canViewMentorship(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const templates = await prisma.mentorNoteTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      updatedAt: true,
      lastUpdatedBy: true,
    },
  });
  return withCors(request, Response.json({ templates }));
}

export async function action({ request }: Route.ActionArgs) {
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
  if (!isCreateBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }
  const name = body.name.trim();
  if (!name) {
    return withCors(request, Response.json({ error: "Name is required" }, { status: 400 }));
  }
  const willBeDefault = body.isDefault === true;
  const created = await prisma.$transaction(async (tx) => {
    if (willBeDefault) {
      await tx.mentorNoteTemplate.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.mentorNoteTemplate.create({
      data: {
        name,
        contentJson: (body.contentJson ?? {}) as object,
        isDefault: willBeDefault,
        lastUpdatedBy: auth.user.sub,
      },
      select: { id: true },
    });
  });
  return withCors(request, Response.json({ id: created.id }));
}
