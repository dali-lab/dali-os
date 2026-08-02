import type { Route } from "./+types/api.mentorship.notes.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { canViewMentorship, canViewMentorNote } from "../lib/visibility";

// GET    /api/mentorship/notes/:id  — read one (author, same-domain mentor, or Core/Admin).
//                                     contentJson is normalized to block JSON.
// PATCH  /api/mentorship/notes/:id  — update vibe. Author or Core only. The body
//                                     is a collaborative document (Hocuspocus
//                                     sync-back owns contentJson writes).
// DELETE /api/mentorship/notes/:id  — delete. Author or Core only.

type PatchBody = { vibe?: "Good" | "Ok" | "Bad" | null };

const VIBES = ["Good", "Ok", "Bad"] as const;

function isPatchBody(x: unknown): x is PatchBody {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(o, "vibe")) return false;
  if (o.vibe !== null && !VIBES.includes(o.vibe as never)) return false;
  return true;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (!(await canViewMentorship(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const note = await prisma.mentorNote.findUnique({
    where: { id: params.id! },
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      contentJson: true,
      vibe: true,
      updatedAt: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  if (!(await canViewMentorNote(auth.user.sub, note))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }
  const [project, term, domain] = await Promise.all([
    prisma.project.findUnique({
      where: { id: note.projectId },
      select: { id: true, name: true },
    }),
    prisma.term.findUnique({
      where: { id: note.termId },
      select: { id: true, code: true },
    }),
    prisma.domain.findUnique({
      where: { id: note.domainId },
      select: { id: true, code: true, displayName: true },
    }),
  ]);
  return withCors(
    request,
    Response.json({
      ...note,
      contentJson: ensureBlocks(note.contentJson),
      weekOf: note.weekOf.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      project,
      term,
      domain,
    }),
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const note = await prisma.mentorNote.findUnique({
    where: { id: params.id! },
    select: { id: true, mentorId: true },
  });
  if (!note) {
    return withCors(request, Response.json({ error: "Not found" }, { status: 404 }));
  }
  const core = await isCore(auth.user.sub);
  if (note.mentorId !== auth.user.sub && !core) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  if (request.method === "DELETE") {
    await prisma.mentorNote.delete({ where: { id: note.id } });
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
  await prisma.mentorNote.update({
    where: { id: note.id },
    data: { vibe: body.vibe ?? null },
  });
  return withCors(request, Response.json({ ok: true }));
}
