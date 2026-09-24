// Resource route — streams the member's own signed copy as a PDF.
// Auth mirrors sign.$bindingId.tsx loader exactly.

import { redirect } from "react-router";
import type { Route } from "./+types/sign.$bindingId.pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import {
  getBindingStateForUser,
  menteeCountersignState,
  getSignedCopyBody,
} from "~/signing/lib/state.server";
import type { PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const bindingId = params.bindingId!;

  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      termId: true,
      document: { select: { name: true } },
      version: { select: { body: true } },
    },
  });
  if (!binding) return redirect("/sign");

  // Which role's signed copy to stream. A mentee's countersigned copy lives
  // under roleKey "mentee"; everyone else's under "member". If they've signed
  // neither, bounce to the sign page (which gates access itself).
  const [memberState, menteeState] = await Promise.all([
    getBindingStateForUser(userId, bindingId, "member"),
    menteeCountersignState(userId, bindingId, request),
  ]);
  const roleKey =
    memberState.status === "signed" ? "member" : menteeState === "signed" ? "mentee" : null;
  if (!roleKey) return redirect(`/sign/${bindingId}`);

  // Compose the co-signed copy (signer's frozen snapshot + the counterpart's
  // signature overlaid), same as the UI route. frozenBody is null for
  // seeded/legacy signatures; fall back to the version body.
  const signedRaw = (await getSignedCopyBody(bindingId, userId, roleKey)) ?? binding.version.body;
  if (!signedRaw) return redirect(`/sign/${bindingId}`);

  // A render failure must return a readable error, not the SPA's HTML error
  // document (a component-less resource route otherwise falls through to the
  // root error boundary, and the browser "downloads" that HTML as the PDF).
  let pdf: Buffer;
  try {
    pdf = await renderDocumentPdf(
      binding.document.name,
      signedRaw as PMNode | DocBlock[],
    );
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
      "Content-Disposition": `inline; filename="${binding.document.name.replace(/[^a-z0-9]+/gi, "-")}.pdf"`,
    },
  });
}
