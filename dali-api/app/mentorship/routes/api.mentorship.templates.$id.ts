import type { Route } from "./+types/api.mentorship.templates.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { canViewMentorship } from "../lib/visibility";

// GET    /api/mentorship/templates/:id  — read (any lab mentor / Core)
// PATCH  /api/mentorship/templates/:id  — update name/contentJson/isDefault. Core only.
//                                        Setting isDefault=true clears the flag on
//                                        any other template in the same call.
// DELETE /api/mentorship/templates/:id  — delete. Core only.

type PatchBody = {
  name?: string;
  contentJson?: unknown;
  isDefault?: boolean;
};

function isPatchBody(x: unknown): x is PatchBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.name !== undefined && typeof o.name !== "string") return false;
  if (o.isDefault !== undefined && typeof o.isDefault !== "boolean") return false;
  return true;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canViewMentorship(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const tpl = await prisma.mentorNoteTemplate.findUnique({
    where: { id: params.id! },
    select: {
      id: true,
      name: true,
      contentJson: true,
      isDefault: true,
      updatedAt: true,
      lastUpdatedBy: true,
    },
  });
  if (!tpl) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  return withCors(request, Response.json(tpl));
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const tpl = await prisma.mentorNoteTemplate.findUnique({
    where: { id: params.id! },
    select: { id: true },
  });
  if (!tpl) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.mentorNoteTemplate.delete({ where: { id: tpl.id } });
    return withCors(request, Response.json({ ok: true }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isPatchBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const data: {
    name?: string;
    contentJson?: object;
    isDefault?: boolean;
    lastUpdatedBy?: string;
  } = { lastUpdatedBy: auth.user.sub };
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) {
      return withCors(request, Response.json({ error: "Name is required" }, { status: 400 }));
    }
    data.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(body, "contentJson")) {
    data.contentJson = (body.contentJson ?? {}) as object;
  }
  if (body.isDefault !== undefined) {
    data.isDefault = body.isDefault;
  }

  await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.mentorNoteTemplate.updateMany({
        where: { isDefault: true, NOT: { id: tpl.id } },
        data: { isDefault: false },
      });
    }
    await tx.mentorNoteTemplate.update({ where: { id: tpl.id }, data });
  });
  return withCors(request, Response.json({ ok: true }));
}
