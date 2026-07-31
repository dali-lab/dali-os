// Member fill/sign surface for one binding. Generalizes the confidentiality
// sign page: renders the in-force version with the member's fields interactive,
// validates + records the signature, and shows the signed copy afterward.

import { redirect, Link, useLoaderData } from "react-router";
import { ShieldCheck, Download } from "lucide-react";
import type { Route } from "./+types/sign.$bindingId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { DocEditor, looksLikeProseMirrorDoc } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { renderNodes, type PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";
import { collectSigningFields } from "~/lib/signing-fields";
import { getBindingStateForUser, getSignerCohorts } from "~/signing/lib/state.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { recordSignature } from "~/signing/lib/sign.server";
import { resolveSigningVariablesForSigner } from "~/signing/lib/variables.server";
import { SigningFillView } from "~/signing/components/SigningFillView";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${(data as { name?: string } | undefined)?.name ?? "Sign"} · DALI OS` },
];

function isSafeNext(next: string | null): next is string {
  return !!next && next.startsWith("/") && !next.startsWith("//");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
      document: { select: { name: true, audience: true } },
      version: { select: { body: true } },
      signatures: {
        where: { roleKey: "supervisor" },
        select: { typedName: true },
        take: 1,
      },
    },
  });
  if (!binding) return redirect("/sign");

  const [state, cohorts] = await Promise.all([
    getBindingStateForUser(userId, bindingId),
    getSignerCohorts(userId),
  ]);

  // Gate direct access: only members in the audience (or someone who already
  // signed) may open this. Confidentiality (HiringCycle) never lands here.
  const inAudience = AUDIENCE_RESOLVERS[binding.document.audience].includes(cohorts);
  if (state.status !== "signed" && !inAudience) return redirect("/");

  const supervisorName = binding.signatures[0]?.typedName ?? "";
  const variables = await resolveSigningVariablesForSigner(userId, { supervisorName });

  // Convert-on-read: the fill surface and field validation walk block JSON;
  // legacy ProseMirror version rows are normalized here (never rewritten).
  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);

  // The signed copy is the FROZEN body: pre-migration signatures are legacy
  // ProseMirror JSON (rendered server-side via the legacy walker — never
  // transcoded), new ones are block JSON (rendered by the block viewer).
  let signedRaw: unknown = null;
  let signedLegacyHtml: string | null = null;
  let signedBlocks: DocBlock[] | null = null;
  if (state.status === "signed") {
    const mine = await prisma.signingSignature.findUnique({
      where: {
        bindingId_signerUserId_roleKey: { bindingId, signerUserId: userId, roleKey: "member" },
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
    status: state.status,
    next,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

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

  const result = await recordSignature({
    bindingId,
    signerUserId: auth.user.sub,
    fieldValues,
    request,
  });
  if (!result.ok) return { error: result.error };

  return redirect(next ?? "/sign");
}

export default function SignBindingPage() {
  const data = useLoaderData<typeof loader>();

  if (data.status === "signed") {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-green-600" />
          <h1 className="text-2xl font-bold text-foreground">You have signed {data.name}</h1>
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
        Please read the agreement below and complete your fields to sign.
      </p>
      <SigningFillView
        body={data.body}
        variables={data.variables}
        fields={data.fields}
        next={data.next}
      />
    </div>
  );
}
