import type { Route } from "./+types/api.custom-hires";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isLabMember } from "~/lib/roles";

// GET/POST /api/custom-hires — a member's own non-DALI paid roles.
//
// Always scoped to the session user. There is no id-in-the-body path that
// could reach someone else's hire: every write filters on { id, userId }.

const MAX_LABEL = 80;

export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  const hires = await prisma.customHire.findMany({
    where: { userId: auth.user.sub, archivedAt: null },
    orderBy: { label: "asc" },
    select: { id: true, label: true },
  });
  return withCors(request, Response.json({ hires }));
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  // Lab members only — these hang off the timesheet, which applicants and
  // partner users don't have.
  if (!(await isLabMember(userId))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const label = String(form.get("label") ?? "").trim();

  switch (intent) {
    case "create": {
      if (!label) {
        return withCors(request, Response.json({ error: "Give the role a name" }, { status: 400 }));
      }
      if (label.length > MAX_LABEL) {
        return withCors(
          request,
          Response.json({ error: `Keep it under ${MAX_LABEL} characters` }, { status: 400 }),
        );
      }
      // Re-adding a name the member archived revives that row rather than
      // colliding with the unique index — their old entries keep pointing at it.
      const existing = await prisma.customHire.findUnique({
        where: { userId_label: { userId, label } },
        select: { id: true, archivedAt: true },
      });
      if (existing) {
        if (existing.archivedAt) {
          await prisma.customHire.update({
            where: { id: existing.id },
            data: { archivedAt: null },
          });
        }
        return withCors(request, Response.json({ ok: true, id: existing.id, label }));
      }
      const created = await prisma.customHire.create({
        data: { userId, label },
        select: { id: true },
      });
      return withCors(request, Response.json({ ok: true, id: created.id, label }));
    }
    case "rename": {
      if (!id || !label) {
        return withCors(request, Response.json({ error: "Missing name" }, { status: 400 }));
      }
      const res = await prisma.customHire.updateMany({
        where: { id, userId },
        data: { label: label.slice(0, MAX_LABEL) },
      });
      if (res.count === 0) {
        return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      }
      return withCors(request, Response.json({ ok: true }));
    }
    case "archive": {
      // Soft delete: time already attributed to this hire keeps its label, and
      // past exports stay intact.
      const res = await prisma.customHire.updateMany({
        where: { id, userId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (res.count === 0) {
        return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
      }
      return withCors(request, Response.json({ ok: true }));
    }
    default:
      return withCors(request, Response.json({ error: "Unknown action" }, { status: 400 }));
  }
}
