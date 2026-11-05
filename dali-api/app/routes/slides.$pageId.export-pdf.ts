import type { Route } from "./+types/slides.$pageId.export-pdf";
import { requireAuth, isPartnerAccount, isNonMember } from "~/lib/auth";
import { exportDeckPdf } from "~/lib/slide-pdf.server";

// GET /slides/:pageId/export.pdf[?notes=1]
export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (await isNonMember(auth, request)) return new Response("Forbidden", { status: 403 });
  if (await isPartnerAccount(auth)) return new Response("Forbidden", { status: 403 });

  const notes = new URL(request.url).searchParams.get("notes") === "1";
  const result = await exportDeckPdf(auth.user.sub, params.pageId, { notes }, request);
  if (!result.ok) return new Response(result.error, { status: result.status });
  return new Response(new Uint8Array(result.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
}
