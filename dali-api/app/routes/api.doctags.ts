import type { Route } from "./+types/api.doctags";
import { z } from "zod";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";

// Lab-wide document/file tags.
//   GET  /api/doctags                      → active tags (any authenticated member)
//   POST /api/doctags  { label }           → create a tag (Core only)
//
// New tags are Core-managed (mirrors the curated Domain registry); anyone with
// edit access on a doc/file may *apply* existing tags via the join-table
// endpoints. Archived tags are excluded from the list but stay attached to
// items they were applied to.

const CreateTagSchema = z.object({
  label: z.string().trim().min(1).max(40),
  color: z.string().trim().max(32).optional(),
});

// Lowercased, hyphenated, alnum-only identifier. Keeps "UI/UX" → "ui-ux".
function slugify(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tag"
  );
}

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const tags = await prisma.docTag.findMany({
    where: { archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true, slug: true, color: true },
  });
  return withCors(request, Response.json(tags));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await isCore(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const body = await parseJson(request, CreateTagSchema);
  if (body instanceof Response) return withCors(request, body);

  const slug = slugify(body.label);
  // Re-activate a previously archived tag with the same slug rather than
  // colliding on the unique constraint.
  const existing = await prisma.docTag.findUnique({ where: { slug } });
  if (existing) {
    if (existing.archivedAt) {
      const revived = await prisma.docTag.update({
        where: { id: existing.id },
        data: { archivedAt: null, label: body.label, color: body.color ?? existing.color },
        select: { id: true, label: true, slug: true, color: true },
      });
      return withCors(request, Response.json(revived, { status: 200 }));
    }
    return withCors(request, Response.json({ error: "A tag with that name already exists" }, { status: 409 }));
  }

  const tag = await prisma.docTag.create({
    data: { label: body.label, slug, color: body.color ?? null },
    select: { id: true, label: true, slug: true, color: true },
  });
  await logAuditEvent({
    action: "doctag.create",
    userId: auth.user.sub,
    targetId: tag.id,
    metadata: { label: tag.label, slug: tag.slug },
    request,
  });
  return withCors(request, Response.json(tag, { status: 201 }));
}
