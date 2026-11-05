import type { Route } from "./+types/slides.$pageId.export-pptx";
import { requireAuth, isPartnerAccount, isNonMember } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { buildDeckPptx } from "~/components/slides/pptx/export.server";
import { createImageLoader } from "~/components/slides/pptx/export-images.server";

const PPTX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function pptxFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "deck";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (await isNonMember(auth, request)) return new Response("Forbidden", { status: 403 });
  if (await isPartnerAccount(auth)) return new Response("Forbidden", { status: 403 });

  const access = await deckAccess(auth.user.sub, params.pageId, request);
  if (!access.ok) return new Response("Not found", { status: 404 });

  const read = await readDeckModel(params.pageId);
  const built = await buildDeckPptx(read, {
    title: access.page.title,
    loadImage: createImageLoader(),
    origin: new URL(request.url).origin,
  });
  await logAuditEvent({
    action: "document.export",
    userId: auth.user.sub,
    targetId: params.pageId,
    metadata: { format: "pptx", kind: "slides", slides: built.slideCount },
    request,
  });
  return new Response(new Uint8Array(built.buffer), {
    headers: {
      "Content-Type": PPTX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${pptxFilename(access.page.title)}.pptx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
