import type { Route } from "./+types/api.files.$id.share";
import { requireMemberSession } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { listFileShares } from "~/lib/file-sharing.server";
import { errorResponse } from "~/lib/http-error.server";
import { loadShareOptions, parsePermission, parseLinkAccess } from "~/lib/share-params.server";
import {
  requireFileShareManager,
  setFileGeneralAccess,
  shareFileWith,
  unshareFile,
} from "~/lib/file-share-access.server";

// POST /api/files/:id/share — the file counterpart of /api/pages/:id/share,
// dispatched on `intent`. Every intent is gated by requireFileShareManager.

export async function action({ request, params }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;
  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }

  const gate = await requireMemberSession(request);
  if (!gate.ok) return withCors(request, gate.response);
  const me = gate.auth.user.sub;
  const fileId = params.id;

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (k: string) => {
    const v = form.get(k);
    return v === null ? undefined : String(v);
  };
  const json = (body: unknown, status = 200) => withCors(request, Response.json(body, { status }));

  try {
    switch (intent) {
      case "state": {
        const context = await requireFileShareManager(fileId, me, request);
        return json({ ok: true, context, shares: await listFileShares(fileId) });
      }
      case "share-options": {
        await requireFileShareManager(fileId, me, request);
        const q = (str("q") ?? "").trim();
        return json({ ok: true, ...(await loadShareOptions(me, q)) });
      }
      case "share-add":
      case "share-change": {
        const principalType = str("principalType") === "Group" ? "Group" : "User";
        const principalId = str("principalId") ?? "";
        if (!principalId) return json({ error: "Pick someone to share with" }, 400);
        const res = await shareFileWith({
          fileId,
          actorId: me,
          principalType,
          principalId,
          permission: parsePermission(str("permission")),
          request,
        });
        return json(res);
      }
      case "share-remove": {
        await unshareFile({ fileId, actorId: me, shareId: str("shareId") ?? "", request });
        return json({ ok: true });
      }
      case "general-access": {
        await requireFileShareManager(fileId, me, request);
        const result = await setFileGeneralAccess(fileId, me, {
          linkAccess: parseLinkAccess(str("linkAccess")),
          linkPermission: parsePermission(str("linkPermission")),
        });
        return json({ ok: true, ...result });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return errorResponse(err, request);
  }
}
