// Member fill/sign surface for one binding. Generalizes the confidentiality
// sign page: renders the in-force version with the member's fields interactive,
// validates + records the signature, and shows the signed copy afterward.

import { redirect, Link, useLoaderData } from "react-router";
import { ShieldCheck } from "lucide-react";
import type { Route } from "./+types/sign.$bindingId";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { RichTextViewer } from "~/components/RichTextViewer";
import { collectSigningFields } from "~/lib/signing-fields";
import { getBindingStateForUser, getSignerCohorts } from "~/signing/lib/state.server";
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
  const inAudience =
    (binding.document.audience === "ActiveMembers" && cohorts.isMember) ||
    (binding.document.audience === "Mentors" && cohorts.isMentor);
  if (state.status !== "signed" && !inAudience) return redirect("/");

  const supervisorName = binding.signatures[0]?.typedName ?? "";
  const variables = await resolveSigningVariablesForSigner(userId, { supervisorName });
  const fields = collectSigningFields(binding.version.body);

  let signedBody: unknown = null;
  if (state.status === "signed") {
    const mine = await prisma.signingSignature.findUnique({
      where: {
        bindingId_signerUserId_roleKey: { bindingId, signerUserId: userId, roleKey: "member" },
      },
      select: { frozenBody: true },
    });
    signedBody = mine?.frozenBody ?? binding.version.body;
  }

  return {
    name: binding.document.name,
    bindingId,
    body: binding.version.body,
    signedBody,
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
          <RichTextViewer content={data.signedBody} enableImages enableSigningFields />
        </article>
        <Link
          to={data.next ?? "/sign"}
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
        >
          Continue
        </Link>
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
