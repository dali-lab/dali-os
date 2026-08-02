import type { Route } from "./+types/api.lab-documents.access";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isLabMember } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import {
  LabDocForbiddenError,
  LabDocNotFoundError,
  requireLabDocAccessManager,
  setLabDocRestricted,
} from "~/lib/lab-documents.server";
import {
  addPageShare,
  listPageShares,
  removePageShare,
  SharePrincipalError,
} from "~/lib/page-sharing.server";

// POST /api/lab-documents/access — who can read a lab-wide document.
//
// Dispatched on `intent`, mirroring /api/notes: these are small mutations on
// one object driven from a single dialog. Every intent that touches a document
// goes through requireLabDocAccessManager (creator or Core); `share-options`
// is a directory lookup gated on lab membership only, and is capped and
// name-scoped so it can't be used to dump the member table.

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
      case "state": {
        const doc = await requireLabDocAccessManager(pageId, me);
        return withCors(
          request,
          Response.json({
            ok: true,
            restricted: doc.labRestricted,
            shares: await listPageShares(pageId),
          }),
        );
      }
      case "restrict":
        await setLabDocRestricted(pageId, me, str("restricted") === "true");
        return withCors(request, Response.json({ ok: true }));
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
      case "share-add": {
        await requireLabDocAccessManager(pageId, me);
        const principalType = str("principalType") === "Group" ? "Group" : "User";
        const principalId = str("principalId") ?? "";
        if (!principalId) {
          return withCors(
            request,
            Response.json({ error: "Pick someone to share with" }, { status: 400 }),
          );
        }
        const res = await addPageShare(pageId, me, principalType, principalId);
        return withCors(request, Response.json(res));
      }
      case "share-remove":
        await requireLabDocAccessManager(pageId, me);
        await removePageShare(pageId, str("shareId") ?? "");
        return withCors(request, Response.json({ ok: true }));
      default:
        return withCors(request, Response.json({ error: "Unknown action" }, { status: 400 }));
    }
  } catch (err) {
    if (err instanceof LabDocNotFoundError) {
      return withCors(request, Response.json({ error: err.message }, { status: 404 }));
    }
    if (err instanceof LabDocForbiddenError) {
      return withCors(request, Response.json({ error: err.message }, { status: 403 }));
    }
    if (err instanceof SharePrincipalError) {
      return withCors(request, Response.json({ error: err.message }, { status: 400 }));
    }
    throw err;
  }
}
