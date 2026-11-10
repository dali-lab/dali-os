import type { Route } from "./+types/documents.$pageId.import";
import { prisma } from "~/lib/db.server";
import { requireAuth, isPartnerAccount, isNonMember } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { logAuditEvent } from "~/lib/audit";
import { MAX_ZIP_BYTES } from "~/lib/drive-download.server";
import { ImportError, importLimitFor, importMarkdownFile } from "~/lib/markdown-import.server";

const BODY_SLACK_BYTES = 1024 * 1024;

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (await isNonMember(auth, request)) return new Response("Forbidden", { status: 403 });
  if (await isPartnerAccount(auth)) return new Response("Forbidden", { status: 403 });

  const page = await prisma.page.findUnique({ where: { id: params.pageId }, select: { id: true } });
  if (!page) return new Response("Not found", { status: 404 });
  const access = await getPageAccess(auth.user.sub, page.id, request);
  if (!access.canEdit) return new Response("Not found", { status: 404 });

  if (Number(request.headers.get("content-length")) > MAX_ZIP_BYTES + BODY_SLACK_BYTES) {
    return Response.json({ error: "That file is too large." }, { status: 413 });
  }
  const file = (await request.formData()).get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to import." }, { status: 400 });
  if (file.size > importLimitFor(file.name)) {
    return Response.json({ error: "That file is too large." }, { status: 413 });
  }

  try {
    const { blocks, skipped } = await importMarkdownFile({
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      pageId: page.id,
      ownOrigin: new URL(request.url).origin,
    });
    await logAuditEvent({
      action: "document.import",
      userId: auth.user.sub,
      targetId: page.id,
      metadata: { skipped },
      request,
    });
    return Response.json({ blocks, skipped });
  } catch (error) {
    if (error instanceof ImportError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
