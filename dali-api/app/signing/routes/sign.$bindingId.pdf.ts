// Resource route — streams the member's own signed copy as a PDF.
// Auth mirrors sign.$bindingId.tsx loader exactly.

import { redirect } from "react-router";
import type { Route } from "./+types/sign.$bindingId.pdf";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { renderProseMirrorToPdf } from "~/collab/export-pdf";
import { getBindingStateForUser, getSignerCohorts } from "~/signing/lib/state.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import type { PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const userId = auth.user.sub;
  const bindingId = params.bindingId!;

  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      document: { select: { name: true, audience: true } },
      version: { select: { body: true } },
    },
  });
  if (!binding) return redirect("/sign");

  const [state, cohorts] = await Promise.all([
    getBindingStateForUser(userId, bindingId),
    getSignerCohorts(userId),
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

  const pdf = await renderProseMirrorToPdf(
    binding.document.name,
    signedRaw as PMNode | DocBlock[],
  );
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${binding.document.name.replace(/[^a-z0-9]+/gi, "-")}.pdf"`,
    },
  });
}
