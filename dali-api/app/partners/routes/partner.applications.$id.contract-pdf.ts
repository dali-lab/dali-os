import type { Route } from "./+types/partner.applications.$id.contract-pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { readDocAsBlocks } from "~/collab/read";
import { renderBlocksToPdf } from "~/collab/export-pdf";
import type { DocBlock } from "~/collab/blocknote-server";

// GET /partner/applications/:id/contract.pdf
//
// The signed contract as a PDF (pdfkit), with a signature/audit page appended
// (signer, legal entity, timestamp, IP, body hash). Readable by the applicant,
// their org members, or Core. Only once the contract is signed.

function para(text: string, bold = false): DocBlock {
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: {},
    content: text
      ? [{ type: "text", text, styles: bold ? { bold: true } : {} }]
      : [],
    children: [],
  } as DocBlock;
}

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
      contractFee: true,
      legalEntityName: true,
      legalEntityAddress: true,
      contractSignedAt: true,
      contractSignerName: true,
      contractSignerIp: true,
      contractSignedHash: true,
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

  if (!app.contractSignedAt) {
    return new Response("This contract hasn't been signed yet.", { status: 409 });
  }

  const body = await readDocAsBlocks(`partnercontract:${app.id}:body`);
  const audit: DocBlock[] = [
    para(""),
    para("Signature", true),
    para(`Signed by: ${app.contractSignerName ?? "—"}`),
    para(`On behalf of: ${app.legalEntityName ?? "—"}`),
    ...(app.legalEntityAddress ? [para(`Address: ${app.legalEntityAddress}`)] : []),
    ...(app.contractFee ? [para(`Fee: ${app.contractFee}`)] : []),
    para(`Signed at: ${app.contractSignedAt.toISOString()}`),
    ...(app.contractSignerIp ? [para(`Signer IP: ${app.contractSignerIp}`)] : []),
    ...(app.contractSignedHash
      ? [para(`Document hash (SHA-256): ${app.contractSignedHash}`)]
      : []),
  ];

  const pdf = await renderBlocksToPdf(`${app.title} — Contract`, [
    ...body,
    ...audit,
  ]);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeFilename(app.title)}_contract.pdf"`,
    },
  });
}
