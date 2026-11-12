import type { Route } from "./+types/api.pages.$id.share";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { errorResponse } from "~/lib/http-error.server";
import { isLabMember } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { loadShareOptions, parsePermission, parseLinkAccess } from "~/lib/share-params.server";
import {
  addPageShare,
  listPageShares,
  removePageShare,
} from "~/lib/page-sharing.server";
import { describePageAudience } from "~/lib/page-audience.server";
import {
  requirePageShareManager,
  setGeneralAccess,
  setFolderScope,
  notifyDocumentShared,
} from "~/lib/page-share-access.server";
import type { ScopeKind } from "~/generated/prisma/client";

// POST /api/pages/:id/share — the one sharing endpoint for every document
// (Project, Lab, EducationOffering, Member). Dispatched on `intent`, mirroring
// /api/lab-documents/access which it supersedes. Every mutating intent goes
// through requirePageShareManager (the per-workspace manage gate); only
// `share-options` is a directory lookup gated on lab membership, capped and
// name-scoped so it can't dump the member table.

const SCOPE_KINDS: readonly string[] = ["Private", "Lab", "Group"];
// "" / anything else → null, meaning "inherit" (clear the folder scope).
function parseScopeKind(v: string | undefined): ScopeKind | null {
  return v && SCOPE_KINDS.includes(v) ? (v as ScopeKind) : null;
}

/** Share rows a meeting's roster created or raised, with the first meeting that justifies each. */
async function markViaMeeting<T extends { id: string }>(
  shares: T[],
): Promise<Array<T & { viaMeeting: { meetingTitle: string } | null }>> {
  if (shares.length === 0) return [];
  const grants = await prisma.meetingShareGrant.findMany({
    where: { pageShareId: { in: shares.map((s) => s.id) } },
    select: { pageShareId: true, meeting: { select: { title: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byShare = new Map<string, string>();
  for (const g of grants) if (!byShare.has(g.pageShareId)) byShare.set(g.pageShareId, g.meeting.title);
  return shares.map((s) => ({
    ...s,
    viaMeeting: byShare.has(s.id) ? { meetingTitle: byShare.get(s.id)! } : null,
  }));
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
        const [shares, { audience, inherited }] = await Promise.all([
          listPageShares(pageId),
          describePageAudience(me, pageId),
        ]);
        return withCors(
          request,
          Response.json({ ok: true, context, shares: await markViaMeeting(shares), audience, inherited }),
        );
      }
      case "share-options": {
        if (!(await isLabMember(me))) {
          return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
        }
        const q = (str("q") ?? "").trim();
        return withCors(request, Response.json({ ok: true, ...(await loadShareOptions(me, q)) }));
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
      case "folder-scope": {
        await requirePageShareManager(pageId, me);
        const result = await setFolderScope(pageId, me, {
          scopeKind: parseScopeKind(str("scopeKind")),
          scopeGroupId: str("scopeGroupId") ?? null,
          scopePermission: str("scopePermission")
            ? parsePermission(str("scopePermission"))
            : null,
        });
        return withCors(request, Response.json({ ok: true, ...result }));
      }
      default:
        return withCors(request, Response.json({ error: "Unknown action" }, { status: 400 }));
    }
  } catch (err) {
    return errorResponse(err, request);
  }
}
