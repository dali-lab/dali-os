// Admin view of ONE member's completed, signed copy of an agreement — the
// frozen archival body (captured field values + resolved variables baked in)
// plus signing metadata. PDF download lives at the sibling resource route.

import { redirect, Link, useLoaderData } from "react-router";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";
import type { Route } from "./+types/admin.agreements.$id.signature.$sigId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { fullName, formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { DocEditor, looksLikeProseMirrorDoc } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { renderNodes, type PMNode } from "~/collab/export-html";

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
    return redirect(`/admin/agreements/${params.id}`);
  }

  // The frozen archival body is NEVER transcoded: pre-migration rows are
  // legacy ProseMirror JSON and render via the legacy PM walker; post-migration
  // rows are block JSON and render via the block viewer. Format-sniff on read.
  const body = sig.frozenBody ?? sig.version.body;

  const isLegacy = looksLikeProseMirrorDoc(body);
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
    legacyHtml: isLegacy ? renderNodes((body as PMNode).content) : null,
    blocks: isLegacy ? null : ensureBlocks(body),
  };
}

export default function SignatureViewPage() {
  const data = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();

  return (
    <div className="max-w-3xl mx-auto py-8 space-y-6">
      <Link
        to={`/admin/agreements/${data.documentId}`}
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
          href={`/admin/agreements/${data.documentId}/signature/${data.signatureId}/pdf`}
          className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg text-foreground bg-card border border-border hover:bg-muted/50 shrink-0"
        >
          <Download className="w-4 h-4" /> PDF
        </a>
      </div>

      <article className="bg-card border border-border rounded-lg p-8 shadow-sm">
        {data.legacyHtml != null ? (
          // Pre-migration frozen copy: server-rendered by the legacy PM walker
          // (renderNodes escapes all text/attrs).
          <div
            className="prose prose-sm dark:prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: data.legacyHtml }}
          />
        ) : (
          <DocEditor
            features="agreement"
            editable={false}
            initialContent={data.blocks ?? []}
            signing={{ mode: "view" }}
          />
        )}
      </article>
    </div>
  );
}
