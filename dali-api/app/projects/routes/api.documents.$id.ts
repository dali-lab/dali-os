import type { Route } from "./+types/api.documents.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isHiringLead } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";

// POST   /api/documents/:id — rename. Body: { title }
// DELETE /api/documents/:id — soft delete (sets archivedAt, matching the
//                             Page model's documented soft-delete pattern;
//                             archived pages drop out of the project list).
//
// Documents are project-scoped FreeForm Pages. Same permission model as
// project edit (isHiringLead === Admin || Core).

type Body = { title: string };

function isBody(x: unknown): x is Body {
  return !!x && typeof x === "object" && typeof (x as Record<string, unknown>).title === "string";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await isHiringLead(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const pageId = params.id!;
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { id: true, workspaceType: true },
  });
  if (!page || page.workspaceType !== "Project") {
    return withCors(request, Response.json({ error: "Document not found" }, { status: 404 }));
  }

  if (request.method === "DELETE") {
    await prisma.page.update({
      where: { id: pageId },
      data: { archivedAt: new Date() },
    });
    return withCors(request, Response.json({ ok: true }));
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

  const title = body.title.trim();
  if (!title) {
    return withCors(request, Response.json({ error: "Title is required" }, { status: 400 }));
  }

  await prisma.page.update({
    where: { id: pageId },
    data: { title, lastEditedById: auth.user.sub },
  });
  return withCors(request, Response.json({ ok: true }));
}
