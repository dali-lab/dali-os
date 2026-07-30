import type { Route } from "./+types/api.notes";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isCore, isLabMember } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import {
  NoteForbiddenError,
  NoteNotFoundError,
} from "~/members/lib/personal-notes.server";
import {
  addNoteShare,
  archiveNote,
  createNote,
  deleteNote,
  listNoteShares,
  proposeLabListing,
  removeNoteShare,
  reviewLabListing,
  setNoteVisibility,
  updateNote,
  withdrawLabListing,
} from "~/members/lib/personal-notes-actions.server";

// POST /api/notes — every write for personal notes, dispatched on `intent`.
//
// One route rather than a dozen: these are all small mutations on the same
// object, invoked from the profile rail and the note's own header, and the
// per-intent gates live in the action helpers rather than here.
//
// Ownership is enforced inside each helper (requireNoteOwner). The only
// exception is `review`, which is Core's decision on a listing proposal and is
// gated here.

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const me = auth.user.sub;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const pageId = String(form.get("pageId") ?? "");
  const str = (k: string) => {
    const v = form.get(k);
    return v === null ? undefined : String(v);
  };

  try {
    switch (intent) {
      case "create": {
        // A member only ever creates notes in their own space; the ownerId in
        // the form is ignored in favour of the session.
        const created = await createNote(me, {
          title: str("title"),
          parentPageId: str("parentPageId") || null,
          isFolder: str("isFolder") === "true",
        });
        return withCors(request, Response.json({ ok: true, id: created.id }));
      }
      case "update":
        await updateNote(pageId, me, {
          title: str("title"),
          iconEmoji: form.has("iconEmoji") ? (str("iconEmoji") ?? null) : undefined,
          parentPageId: form.has("parentPageId") ? (str("parentPageId") ?? null) : undefined,
        });
        return withCors(request, Response.json({ ok: true }));
      case "visibility":
        await setNoteVisibility(pageId, me, str("public") === "true");
        return withCors(request, Response.json({ ok: true }));
      // Who the owner can share with: lab members matching a query, plus the
      // groups they belong to. Scoped to lab members and capped, so the share
      // picker can't be used as a directory dump.
      case "share-options": {
        if (!(await isLabMember(me))) {
          return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
        }
        const q = (str("q") ?? "").trim();
        const [members, groups] = await Promise.all([
          q.length < 2
            ? Promise.resolve([])
            : prisma.user.findMany({
                where: {
                  id: { not: me },
                  daliMember: { isNot: null },
                  OR: [
                    { firstName: { contains: q, mode: "insensitive" } },
                    { lastName: { contains: q, mode: "insensitive" } },
                  ],
                },
                orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
                take: 8,
                select: { id: true, firstName: true, lastName: true },
              }),
          listVisibleGroupsForUser(me),
        ]);
        return withCors(
          request,
          Response.json({
            ok: true,
            members: members.map((m) => ({
              id: m.id,
              label: `${m.firstName} ${m.lastName}`.trim(),
            })),
            groups: groups.map((g) => ({ id: g.id, label: g.name })),
          }),
        );
      }
      case "shares":
        return withCors(
          request,
          Response.json({ ok: true, shares: await listNoteShares(pageId, me) }),
        );
      case "share-add": {
        const principalType = str("principalType") === "Group" ? "Group" : "User";
        const principalId = str("principalId") ?? "";
        if (!principalId) {
          return withCors(request, Response.json({ error: "Pick someone to share with" }, { status: 400 }));
        }
        const res = await addNoteShare(pageId, me, principalType, principalId);
        return withCors(request, Response.json(res));
      }
      case "share-remove":
        await removeNoteShare(pageId, me, str("shareId") ?? "");
        return withCors(request, Response.json({ ok: true }));
      case "propose":
        await proposeLabListing(pageId, me, str("note") ?? null);
        return withCors(request, Response.json({ ok: true }));
      case "withdraw":
        await withdrawLabListing(pageId, me);
        return withCors(request, Response.json({ ok: true }));
      case "archive":
        await archiveNote(pageId, me);
        return withCors(request, Response.json({ ok: true }));
      case "delete":
        await deleteNote(pageId, me);
        return withCors(request, Response.json({ ok: true }));
      case "review": {
        if (!(await isCore(me))) {
          return withCors(
            request,
            Response.json({ error: "Only Core can decide lab listings" }, { status: 403 }),
          );
        }
        const decision = str("decision") === "Listed" ? "Listed" : "Declined";
        await reviewLabListing(pageId, me, decision);
        return withCors(request, Response.json({ ok: true }));
      }
      default:
        return withCors(request, Response.json({ error: "Unknown action" }, { status: 400 }));
    }
  } catch (err) {
    if (err instanceof NoteNotFoundError) {
      return withCors(request, Response.json({ error: err.message }, { status: 404 }));
    }
    if (err instanceof NoteForbiddenError) {
      return withCors(request, Response.json({ error: err.message }, { status: 403 }));
    }
    throw err;
  }
}
