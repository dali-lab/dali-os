// Member fill/sign surface for one binding. Generalizes the confidentiality
// sign page: renders the in-force version with the member's fields interactive,
// validates + records the signature, and shows the signed copy afterward.

import { redirect, Link, useLoaderData, useActionData } from "react-router";
import { ShieldCheck, Download } from "lucide-react";
import type { Route } from "./+types/sign.$bindingId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { DocEditor, looksLikeProseMirrorDoc } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { renderNodes, type PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";
import { collectSigningFields, bakeSigningBody } from "~/lib/signing-fields";
import {
  getBindingStateForUser,
  getSignerCohortsForBinding,
  menteeCountersignState,
} from "~/signing/lib/state.server";
import type { SigningAudience } from "~/generated/prisma/enums";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { recordSignature } from "~/signing/lib/sign.server";
import { notifyCountersignRequest } from "~/signing/lib/notify.server";
import { resolveSigningVariablesForSigner } from "~/signing/lib/variables.server";
import { SigningFillView } from "~/signing/components/SigningFillView";

// Which slot this user fills on a binding, and whether they've completed it.
// Prefer an outstanding member obligation (a mentor signs before their mentee);
// then a mentee countersignature; then a completed member copy so a signed
// mentor can still reopen theirs. null = no access. Shared by the loader (which
// also needs the status) and the action (which must re-derive the role
// server-side rather than trust a client-posted value).
async function resolveSigning(
  userId: string,
  bindingId: string,
  audience: SigningAudience,
  termId: string | null,
  request: Request,
): Promise<{ role: "member" | "mentee"; status: "signed" | "unsigned" } | null> {
  const [memberState, menteeState, cohorts] = await Promise.all([
    getBindingStateForUser(userId, bindingId, "member"),
    menteeCountersignState(userId, bindingId, request),
    getSignerCohortsForBinding(userId, termId),
  ]);
  const inMemberAudience = AUDIENCE_RESOLVERS[audience].includes(cohorts);
  if (inMemberAudience && memberState.status !== "signed") return { role: "member", status: "unsigned" };
  if (menteeState !== "not_owed") {
    return { role: "mentee", status: menteeState === "signed" ? "signed" : "unsigned" };
  }
  if (memberState.status === "signed") return { role: "member", status: "signed" };
  return null;
}

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string } | undefined)?.name ?? "Sign"} · DALI OS` },
];

function isSafeNext(next: string | null): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const bindingId = params.bindingId!;

  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next");
  const next = isSafeNext(nextRaw) ? nextRaw : null;

  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      termId: true,
      document: { select: { name: true, audience: true } },
      version: { select: { body: true } },
      term: { select: { code: true } },
      signatures: {
        where: { roleKey: "supervisor" },
        select: { typedName: true },
        take: 1,
      },
    },
  });
  if (!binding) return redirect("/sign");

  // Gate direct access + pick the slot this user fills. Confidentiality
  // (HiringCycle) never lands here.
  const signing = await resolveSigning(
    userId,
    bindingId,
    binding.document.audience,
    binding.termId,
    request,
  );
  if (!signing) return redirect("/");
  const { role: signerRole, status } = signing;

  const supervisorName = binding.signatures[0]?.typedName ?? "";
  const variables = await resolveSigningVariablesForSigner(userId, {
    supervisorName,
    termCode: binding.term?.code ?? undefined,
  });

  // Convert-on-read: the fill surface and field validation walk block JSON;
  // legacy ProseMirror version rows are normalized here (never rewritten).
  let body = ensureBlocks(binding.version.body);

  // Mentee countersigning: bake their mentor's captured member fields into the
  // body so the mentor's completed signature renders read-only while the mentee
  // fills their own "mentee" fields. Use the EARLIEST-signed mentor when the
  // mentee has more than one (deterministic; the mentee owes a single ack).
  if (signerRole === "mentee") {
    const pairs = await prisma.mentorshipPair.findMany({
      where: { menteeUserId: userId, termId: binding.termId ?? undefined },
      select: { mentorUserId: true },
    });
    if (pairs.length > 0) {
      const mentorSig = await prisma.signingSignature.findFirst({
        where: {
          bindingId,
          roleKey: "member",
          versionId: binding.versionId,
          signerUserId: { in: pairs.map((p) => p.mentorUserId) },
        },
        orderBy: { signedAt: "asc" },
        select: { fieldValues: true },
      });
      if (mentorSig?.fieldValues && typeof mentorSig.fieldValues === "object") {
        body = bakeSigningBody(body, {
          fieldValues: mentorSig.fieldValues as Record<string, unknown>,
        }) as DocBlock[];
      }
    }
  }

  const fields = collectSigningFields(body);

  // The signed copy is the FROZEN body: pre-migration signatures are legacy
  // ProseMirror JSON (rendered server-side via the legacy walker — never
  // transcoded), new ones are block JSON (rendered by the block viewer).
  let signedRaw: unknown = null;
  let signedLegacyHtml: string | null = null;
  let signedBlocks: DocBlock[] | null = null;
  if (status === "signed") {
    const mine = await prisma.signingSignature.findUnique({
      where: {
        bindingId_signerUserId_roleKey: { bindingId, signerUserId: userId, roleKey: signerRole },
      },
      select: { frozenBody: true },
    });
    signedRaw = mine?.frozenBody ?? binding.version.body;
    if (looksLikeProseMirrorDoc(signedRaw)) {
      signedLegacyHtml = renderNodes((signedRaw as PMNode).content);
    } else {
      signedBlocks = ensureBlocks(signedRaw);
    }
  }

  return {
    name: binding.document.name,
    bindingId,
    body,
    signedLegacyHtml,
    signedBlocks,
    variables,
    fields,
    status,
    signerRole,
    next,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const bindingId = params.bindingId!;
  const formData = await request.formData();
  if ((formData.get("intent") as string) !== "sign") return null;

  const nextRaw = formData.get("next") as string | null;
  const next = isSafeNext(nextRaw) ? nextRaw : null;

  let fieldValues: Record<string, unknown> = {};
  try {
    fieldValues = JSON.parse((formData.get("fieldValues") as string) || "{}");
  } catch {
    return { error: "Could not read your inputs — please try again." };
  }

  // Re-derive the role server-side (never trust a client-posted role): the same
  // gate the loader used decides whether this is a member signature or a mentee
  // countersignature.
  const userId = auth.user.sub;
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: { termId: true, document: { select: { audience: true } } },
  });
  if (!binding) return { error: "Agreement not found." };
  const signing = await resolveSigning(
    userId,
    bindingId,
    binding.document.audience,
    binding.termId,
    request,
  );
  if (!signing || signing.status === "signed") {
    return { error: "You can't sign this document right now." };
  }
  const roleKey = signing.role;

  const result = await recordSignature({
    bindingId,
    signerUserId: userId,
    fieldValues,
    request,
    roleKey,
  });
  if (!result.ok) return { error: result.error };

  // A mentor just signed a countersign agreement → ask their mentees to
  // countersign. Fire-and-forget (like the signature receipt): the signature is
  // already durably recorded, and the notify no-ops unless the doc opts in.
  if (roleKey === "member") {
    void notifyCountersignRequest(bindingId, userId).catch((err) =>
      console.error("[signing] countersign notify failed:", err),
    );
  }

  // Land on the signed confirmation view (not the inbox) so the signer gets an
  // explicit "you're done" screen with the emailed-copy note + download. Carry
  // `next` so Continue still returns them to where they came from.
  const signedUrl = `/sign/${bindingId}${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  return redirect(signedUrl);
}

export default function SignBindingPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (data.status === "signed") {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-green-600" />
            <h1 className="text-2xl font-bold text-foreground">You have signed {data.name}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Thanks for signing. A copy has been emailed to you and is available to download below.
          </p>
        </div>
        <article className="bg-card border border-border rounded-lg p-6">
          {data.signedLegacyHtml != null ? (
            // Pre-migration frozen copy: server-rendered by the legacy PM
            // walker (renderNodes escapes all text/attrs).
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: data.signedLegacyHtml }}
            />
          ) : (
            <DocEditor
              features="agreement"
              editable={false}
              initialContent={data.signedBlocks ?? []}
              signing={{ mode: "view" }}
            />
          )}
        </article>
        <div className="flex items-center gap-3">
          <Link
            to={data.next ?? "/sign"}
            className="inline-block px-4 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
          >
            Continue
          </Link>
          <a
            href={`/sign/${data.bindingId}/pdf`}
            className="inline-flex items-center gap-1 px-4 py-2 text-sm font-medium rounded-md text-foreground bg-card border border-border hover:bg-muted/50"
          >
            <Download className="w-4 h-4" /> Download PDF
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <h1 className="text-2xl font-bold text-foreground">{data.name}</h1>
      <p className="text-sm text-muted-foreground">
        {data.signerRole === "mentee"
          ? "Your mentor has signed this agreement. Review it below and add your signature to countersign."
          : "Please read the agreement below and complete your fields to sign."}
      </p>
      <SigningFillView
        body={data.body}
        variables={data.variables}
        fields={data.fields}
        next={data.next}
        error={actionData?.error}
        signerRole={data.signerRole}
      />
    </div>
  );
}
