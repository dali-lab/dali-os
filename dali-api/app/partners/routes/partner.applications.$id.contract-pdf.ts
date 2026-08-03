import type { Route } from "./+types/partner.applications.$id.contract-pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { renderBlocksToPdf } from "~/collab/export-pdf";

// GET /partner/applications/:id/contract.pdf
//
// The signed contract as a PDF. Renders the frozen archival copy captured by the
// signing engine (body with baked field values + resolved variables). Readable
// by the applicant, their org members, or Core; only once signed.

function safeFilename(title: string): string {
  return (
    title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") ||
    "contract"
  );
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });

  const app = await prisma.partnerApplication.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      applicantUserId: true,
      partnerOrgId: true,
      contractBindingId: true,
    },
  });
  if (!app) return new Response("Not found", { status: 404 });

  // Access: Core, the applicant, or a member of the application's org.
  let allowed = false;
  if (auth.user.type === "member") {
    allowed = await isCore(auth.user.sub);
  } else if (app.applicantUserId && app.applicantUserId === auth.user.sub) {
    allowed = true;
  } else if (app.partnerOrgId) {
    const pu = await prisma.partnerUser.findUnique({
      where: { userId: auth.user.sub },
      select: { partnerOrgId: true },
    });
    allowed = pu?.partnerOrgId === app.partnerOrgId;
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });

  if (!app.contractBindingId) {
    return new Response("This contract hasn't been sent yet.", { status: 409 });
  }
  const signature = await prisma.signingSignature.findFirst({
    where: { bindingId: app.contractBindingId, roleKey: "member" },
    orderBy: { signedAt: "desc" },
    select: { frozenBody: true },
  });
  if (!signature?.frozenBody) {
    return new Response("This contract hasn't been signed yet.", { status: 409 });
  }

  const blocks = ensureBlocks(signature.frozenBody);
  const pdf = await renderBlocksToPdf(`${app.title} — Contract`, blocks);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename(app.title)}_contract.pdf"`,
    },
  });
}
