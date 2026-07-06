import type { Route } from "./+types/api.projects.$id.documents";
import { prisma } from "~/lib/db";
import { requireProjectEditAccess } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";

// POST /api/projects/:id/documents
//
// Add a project document. Documents are FreeForm Pages scoped to the
// project workspace (workspaceType=Project, workspaceId=projectId) — the
// same Page model the project Overview/PRD use. Body: { title }.
//
// The rich-text body lives in the collab editor (contentDocId), which is a
// separate system; this route only creates the Page shell + title. Same
// permission model as project edit (isCore === Admin || Core).

type Body = { title: string };

function isBody(x: unknown): x is Body {
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
  const auth = gate.auth;

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

  // Append after the current max position among this project's top-level
  // pages (parentPageId === null).
  const last = await prisma.page.findFirst({
    where: { workspaceType: "Project", workspaceId: params.id, parentPageId: null },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const page = await prisma.page.create({
    data: {
      workspaceType: "Project",
      workspaceId: params.id,
      title,
      kind: "FreeForm",
      position,
      createdById: auth.user.sub,
    },
    select: { id: true },
  });

  return withCors(request, Response.json({ id: page.id }));
}
