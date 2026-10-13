import type { Route } from "./+types/api.projects.$id.epics";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/:id/epics { title } — create an epic, appended last.
// Epics carry no dates: their timeline span follows their tasks' sprints.

function isBody(x: unknown): x is { title: string } {
  return !!x && typeof x === "object" && typeof (x as Record<string, unknown>).title === "string";
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

  const title = body.title.trim();
  if (!title) {
    return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
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
      position,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: epic.id }));
}
