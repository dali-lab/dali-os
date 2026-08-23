// Resource route — streams the member's own signed copy as a PDF.
// Auth mirrors sign.$bindingId.tsx loader exactly.

import { redirect } from "react-router";
import type { Route } from "./+types/sign.$bindingId.pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { renderProseMirrorToPdf } from "~/collab/export-pdf";
import { getBindingStateForUser, getSignerCohortsForBinding } from "~/signing/lib/state.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
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
      document: { select: { name: true, audience: true } },
      version: { select: { body: true } },
    },
  });
  if (!binding) return redirect("/sign");

  const [state, cohorts] = await Promise.all([
    getBindingStateForUser(userId, bindingId),
    getSignerCohortsForBinding(userId, binding.termId),
  ]);

  const inAudience = AUDIENCE_RESOLVERS[binding.document.audience].includes(cohorts);
  if (state.status !== "signed" && !inAudience) return redirect("/");
  if (state.status !== "signed") return redirect(`/sign/${bindingId}`);

  const mine = await prisma.signingSignature.findUnique({
    where: {
      bindingId_signerUserId_roleKey: { bindingId, signerUserId: userId, roleKey: "member" },
    },
    select: { frozenBody: true },
  });

  // frozenBody is null for seeded/legacy signatures; fall back to the version body,
  // matching the behaviour of the UI-route loader (mine?.frozenBody ?? binding.version.body).
  const signedRaw = mine?.frozenBody ?? binding.version.body;
  if (!signedRaw) return redirect(`/sign/${bindingId}`);

  // A render failure must return a readable error, not the SPA's HTML error
  // document (a component-less resource route otherwise falls through to the
  // root error boundary, and the browser "downloads" that HTML as the PDF).
  let pdf: Buffer;
  try {
    pdf = await renderProseMirrorToPdf(
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
