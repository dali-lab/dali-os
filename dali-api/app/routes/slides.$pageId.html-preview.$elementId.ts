import type { Route } from "./+types/slides.$pageId.html-preview.$elementId";
import { requireAuth, isPartnerAccount, isNonMember } from "~/lib/auth";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { getHtmlPreview } from "~/lib/slide-html-preview.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (await isNonMember(auth, request)) return new Response("Forbidden", { status: 403 });
  if (await isPartnerAccount(auth)) return new Response("Forbidden", { status: 403 });

  const access = await deckAccess(auth.user.sub, params.pageId, request);
  if (!access.ok) return new Response("Not found", { status: 404 });

  const preview = await getHtmlPreview(params.pageId, params.elementId, await readDeckModel(params.pageId));
  if (!preview) return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const asked = new URL(request.url).searchParams.get("v");
  return new Response(new Uint8Array(preview.png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": asked === preview.version ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
