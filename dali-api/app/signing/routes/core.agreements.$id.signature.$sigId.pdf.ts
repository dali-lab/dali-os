// Resource route — streams a Core view of a member's signed copy as PDF.
// Auth mirrors core.agreements.$id.signature.$sigId.tsx loader exactly.

import { redirect } from "react-router";
import type { Route } from "./+types/core.agreements.$id.signature.$sigId.pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import type { PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "signed";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const sig = await prisma.signingSignature.findUnique({
    where: { id: params.sigId },
    select: {
      id: true,
      typedName: true,
      frozenBody: true,
      signer: { select: { firstName: true, lastName: true } },
      binding: { select: { documentId: true } },
      version: {
        select: { body: true, document: { select: { name: true } } },
      },
    },
  });
  if (!sig || sig.binding.documentId !== params.id) {
    return redirect(`/core/agreements/${params.id}`);
  }

  const body = sig.frozenBody ?? sig.version.body;
  const title = sig.version.document.name;
  // Prefer the account name for the file name; typedName (often initials) is the
  // fallback only when the signer relation is missing.
  const filename = `${safeFilename(title)}-${safeFilename(fullName(sig.signer) || sig.typedName)}.pdf`;

  // A render failure must return a readable error, not the SPA's HTML error
  // document (a component-less resource route otherwise falls through to the
  // root error boundary, and the browser "downloads" that HTML as the PDF).
  let pdf: Buffer;
  try {
    pdf = await renderDocumentPdf(title, body as PMNode | DocBlock[]);
  } catch (err) {
    console.error("[signing] signed-copy PDF render failed:", err);
    return new Response("Could not render this signed copy as a PDF.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
