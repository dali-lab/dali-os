// Admin view of ONE member's completed, signed copy of an agreement — the
// frozen archival body (captured field values + resolved variables baked in)
// plus signing metadata. `?format=pdf` streams the same copy as a PDF.

import { redirect, Link, useLoaderData } from "react-router";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import type { Route } from "./+types/admin-console.agreements.$id.signature.$sigId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { fullName, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { RichTextViewer } from "~/components/RichTextViewer";
import { renderProseMirrorToPdf } from "~/collab/export-pdf";
import type { PMNode } from "~/collab/export-html";

export const meta: Route.MetaFunction = () => [{ title: "Signed copy · Admin · DALI OS" }];

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "signed";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const sig = await prisma.signingSignature.findUnique({
    where: { id: params.sigId },
    select: {
      id: true,
      roleKey: true,
      typedName: true,
      ip: true,
      userAgent: true,
      signedAt: true,
      frozenBody: true,
      signer: { select: { firstName: true, lastName: true } },
      binding: { select: { documentId: true } },
      version: {
        select: { versionNumber: true, body: true, document: { select: { name: true } } },
      },
    },
  });
  // 404 → back to the agreement; also guard the signature belongs to this doc.
  if (!sig || sig.binding.documentId !== params.id) {
    return redirect(`/admin-console/agreements/${params.id}`);
  }

  const body = (sig.frozenBody ?? sig.version.body) as PMNode;

  const url = new URL(request.url);
  if (url.searchParams.get("format") === "pdf") {
    const title = sig.version.document.name;
    const pdf = await renderProseMirrorToPdf(title, body);
    const filename = `${safeFilename(title)}-${safeFilename(sig.typedName || fullName(sig.signer))}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  }

  return {
    documentId: params.id,
    signatureId: sig.id,
    documentName: sig.version.document.name,
    versionNumber: sig.version.versionNumber,
    signerName: sig.typedName || fullName(sig.signer) || "Unknown",
    roleKey: sig.roleKey,
    signedAt: sig.signedAt,
    ip: sig.ip,
    userAgent: sig.userAgent,
    body,
  };
}

export default function SignatureViewPage() {
  const data = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <Link
        to={`/admin-console/agreements/${data.documentId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Back to agreement
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-600" />
            <h1 className="text-xl font-bold text-foreground">{data.documentName}</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed by <strong>{data.signerName}</strong> ({data.roleKey}) ·{" "}
            {formatDateTime(data.signedAt, tz)} · v{data.versionNumber}
          </p>
          {data.ip && (
            <p className="text-xs text-muted-foreground/70">
              IP {data.ip}
              {data.userAgent ? ` · ${data.userAgent}` : ""}
            </p>
          )}
        </div>
        <a
          href={`/admin-console/agreements/${data.documentId}/signature/${data.signatureId}?format=pdf`}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg text-foreground bg-card border border-border hover:bg-muted/50 shrink-0"
        >
          <Download className="w-4 h-4" /> PDF
        </a>
      </div>

      <article className="bg-card border border-border rounded-lg p-8 shadow-sm">
        <RichTextViewer content={data.body} enableImages enableSigningFields />
      </article>
    </div>
  );
}
