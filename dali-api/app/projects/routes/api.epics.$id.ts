import type { Route } from "./+types/api.epics.$id";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { deleteEpic, GENERAL_EPIC_TITLE } from "../lib/sprints.server";

// POST   /api/epics/:id — edit { title?, description?, cancelled? }.
// DELETE /api/epics/:id — delete; its tasks move to the project's General
//                         epic and its user stories go with it.

type EditBody = { title?: string; description?: string | null; cancelled?: boolean };

function isEditBody(x: unknown): x is EditBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.title !== undefined && typeof o.title !== "string") return false;
  if (o.description !== undefined && o.description !== null && typeof o.description !== "string")
    return false;
  if (o.cancelled !== undefined && typeof o.cancelled !== "boolean") return false;
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
    select: { id: true, projectId: true, title: true, cancelledAt: true },
  });
  if (!epic) {
    return withCors(request, Response.json({ error: "Epic not found" }, { status: 404 }));
  }
  const gate = await requireProjectEditAccess(request, epic.projectId);
  if (!gate.ok) return gate.response;

  if (request.method === "DELETE") {
    const result = await deleteEpic(epicId, epic.projectId);
    if (result === "general-in-use") {
      return withCors(
        request,
        Response.json(
          { error: `Move this epic's tasks elsewhere before deleting ${GENERAL_EPIC_TITLE}.` },
          { status: 409 },
        ),
      );
    }
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

  const data: { title?: string; description?: string | null; cancelledAt?: Date | null } = {};
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) {
      return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
    }
    data.title = title;
  }
  if (body.description !== undefined) {
    const desc = body.description?.trim() ?? "";
    data.description = desc === "" ? null : desc;
  }
  if (body.cancelled !== undefined && body.cancelled !== (epic.cancelledAt !== null)) {
    data.cancelledAt = body.cancelled ? new Date() : null;
  }

  await prisma.epic.update({ where: { id: epicId }, data });
  return withCors(request, Response.json({ ok: true }));
}
