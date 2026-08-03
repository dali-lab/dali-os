import type { Route } from "./+types/api.pages.$id.share";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { isLabMember } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import {
  addPageShare,
  listPageShares,
  removePageShare,
  SharePrincipalError,
} from "~/lib/page-sharing.server";
import {
  requirePageShareManager,
  setGeneralAccess,
  notifyDocumentShared,
  PageShareForbiddenError,
  PageShareNotFoundError,
  GeneralAccessError,
} from "~/lib/page-share-access.server";
import {
  setLabDocRestricted,
  LabDocForbiddenError,
  LabDocNotFoundError,
} from "~/lib/lab-documents.server";
import type { SharePermission, LinkAccess } from "~/generated/prisma/client";

// POST /api/pages/:id/share — the one sharing endpoint for every document
// (Project, Lab, EducationOffering, Member). Dispatched on `intent`, mirroring
// /api/lab-documents/access which it supersedes. Every mutating intent goes
// through requirePageShareManager (the per-workspace manage gate); only
// `share-options` is a directory lookup gated on lab membership, capped and
// name-scoped so it can't dump the member table.

const PERMISSIONS: readonly string[] = ["View", "Comment", "Edit", "FullAccess"];
function parsePermission(v: string | undefined, fallback: SharePermission = "View"): SharePermission {
  return v && PERMISSIONS.includes(v) ? (v as SharePermission) : fallback;
}
const LINK_ACCESSES: readonly string[] = ["Restricted", "SignedIn", "Public"];
function parseLinkAccess(v: string | undefined): LinkAccess {
  return v && LINK_ACCESSES.includes(v) ? (v as LinkAccess) : "Restricted";
}

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const me = auth.user.sub;
  const pageId = params.id;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => {
    const v = form.get(k);
    return v === null ? undefined : String(v);
  };

  try {
    switch (intent) {
      case "state": {
        const context = await requirePageShareManager(pageId, me);
        return withCors(
          request,
          Response.json({ ok: true, context, shares: await listPageShares(pageId) }),
        );
      }
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
      case "share-add":
      case "share-change": {
        const context = await requirePageShareManager(pageId, me);
        const principalType = str("principalType") === "Group" ? "Group" : "User";
        const principalId = str("principalId") ?? "";
        if (!principalId) {
          return withCors(
            request,
            Response.json({ error: "Pick someone to share with" }, { status: 400 }),
          );
        }
        const permission = parsePermission(str("permission"));
        const res = await addPageShare(pageId, me, principalType, principalId, permission);
        // Only a real, changed grant to an individual earns a notification —
        // not groups, not an idempotent no-op re-add.
        if (res.changed && principalType === "User" && principalId !== me) {
          await notifyDocumentShared({
            pageId,
            pageTitle: context.page.title,
            recipientUserId: principalId,
            actorId: me,
          });
        }
        return withCors(request, Response.json(res));
      }
      case "share-remove": {
        await requirePageShareManager(pageId, me);
        await removePageShare(pageId, str("shareId") ?? "");
        return withCors(request, Response.json({ ok: true }));
      }
      case "general-access": {
        await requirePageShareManager(pageId, me);
        const result = await setGeneralAccess(pageId, me, {
          linkAccess: parseLinkAccess(str("linkAccess")),
          linkPermission: parsePermission(str("linkPermission")),
        });
        return withCors(request, Response.json({ ok: true, ...result }));
      }
      case "restrict": {
        // Lab-only base audience: everyone-in-lab vs restricted-to-shares.
        // setLabDocRestricted re-gates (and rejects non-Lab pages), so this is
        // a no-op for other workspace types.
        await setLabDocRestricted(pageId, me, str("restricted") === "true");
        return withCors(request, Response.json({ ok: true }));
      }
      default:
        return withCors(request, Response.json({ error: "Unknown action" }, { status: 400 }));
    }
  } catch (err) {
    if (err instanceof PageShareNotFoundError || err instanceof LabDocNotFoundError) {
      return withCors(request, Response.json({ error: err.message }, { status: 404 }));
    }
    if (err instanceof PageShareForbiddenError || err instanceof LabDocForbiddenError) {
      return withCors(request, Response.json({ error: err.message }, { status: 403 }));
    }
    if (err instanceof SharePrincipalError || err instanceof GeneralAccessError) {
      return withCors(request, Response.json({ error: err.message }, { status: 400 }));
    }
    throw err;
  }
}
