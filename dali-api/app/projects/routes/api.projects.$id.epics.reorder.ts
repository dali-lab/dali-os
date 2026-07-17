import type { Route } from "./+types/api.projects.$id.epics.reorder";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/:id/epics/reorder
//
// Body: { epicIds: string[] } — the project's epics in the new display order.
// Writes each epic's index as its position. `epicIds` must be exactly the
// project's current (non-deleted) epic id set, in some order — this endpoint
// only reorders, it never adds/removes an epic.
// Same permission model as project edit (isCore === Admin || Core, or a
// project member).

type Body = { epicIds: string[] };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return Array.isArray(o.epicIds) && o.epicIds.every((id) => typeof id === "string");
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const gate = await requireProjectEditAccess(request, params.id!);
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

  const existing = await prisma.epic.findMany({
    where: { projectId: params.id },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const submittedIds = new Set(body.epicIds);
  const sameSet =
    existingIds.size === submittedIds.size &&
    [...existingIds].every((id) => submittedIds.has(id));
  if (!sameSet) {
    return withCors(
      request,
      Response.json({ error: "epicIds must match the project's current epics" }, { status: 400 }),
    );
  }

  await prisma.$transaction(
    body.epicIds.map((id, index) =>
      prisma.epic.update({ where: { id }, data: { position: index } }),
    ),
  );

  return withCors(request, Response.json({ ok: true }));
}
