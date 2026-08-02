import { Form, Link, redirect, useLoaderData } from "react-router";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import type { Route } from "./+types/cycles.$cycleId.confidentiality";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { DocEditor } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { isEmptyBody } from "~/lib/signing-fields";

export const meta: Route.MetaFunction = () => [
  { title: "Confidentiality agreement · DALI OS" },
];

function isSafeNext(next: string | null): boolean {
  if (!next) return false;
  // Only allow same-origin paths to prevent open-redirect.
  return next.startsWith("/") && !next.startsWith("//");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const cycleId = params.cycleId!;
  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next");
  const next = isSafeNext(nextRaw) ? nextRaw! : null;

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: cycleId },
    select: { id: true, name: true },
  });
  if (!cycle) return redirect("/");

  const state = await getCycleConfidentialityState(auth.user.sub, cycleId);

  let agreementVersion: {
    id: string;
    versionNumber: number;
    body: unknown;
    agreement: { name: string };
  } | null = null;
  if (state.activeVersionId) {
    const v = await prisma.signingDocumentVersion.findUnique({
      where: { id: state.activeVersionId },
      include: { document: { select: { name: true } } },
    });
    if (v) {
      agreementVersion = {
        id: v.id,
        versionNumber: v.versionNumber,
        // Convert-on-read: legacy ProseMirror bodies → block JSON for DocEditor.
        body: ensureBlocks(v.body),
        agreement: { name: v.document.name },
      };
    }
  }

  return { cycle, state, agreementVersion, next };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const cycleId = params.cycleId!;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const nextRaw = formData.get("next") as string | null;
  const next = isSafeNext(nextRaw) ? nextRaw! : null;

  if (intent !== "sign") return null;

  const binding = await prisma.signingBinding.findFirst({
    where: { cycleId, document: { kind: "Confidentiality" } },
    select: { id: true, versionId: true },
  });
  if (!binding) {
    return { error: "No confidentiality agreement is bound to this cycle" };
  }

  const versionId = binding.versionId;
  const signer = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });
  await prisma.signingSignature.upsert({
    where: {
      bindingId_signerUserId_roleKey: {
        bindingId: binding.id,
        signerUserId: auth.user.sub,
        roleKey: "member",
      },
    },
    create: {
      bindingId: binding.id,
      versionId,
      signerUserId: auth.user.sub,
      roleKey: "member",
      typedName: signer ? `${signer.firstName} ${signer.lastName}`.trim() : "",
      ip: request.headers.get("fly-client-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      userAgent: request.headers.get("user-agent") || null,
      fieldValues: {},
    },
    update: { versionId, signedAt: new Date() },
  });

  await logAuditEvent({
    action: "confidentiality.sign",
    userId: auth.user.sub,
    targetId: cycleId,
    metadata: { versionId },
    request,
  });

  return redirect(next ?? "/");
}

export default function CycleConfidentialityPage() {
  const { cycle, state, agreementVersion, next } = useLoaderData<typeof loader>();

  if (state.status === "no_agreement") {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          <h1 className="text-2xl font-bold text-foreground">
            Confidentiality agreement unavailable
          </h1>
        </div>
        <p className="text-muted-foreground">
          The hiring lead has not yet attached a confidentiality agreement to
          the {cycle.name} cycle. Until they do, sensitive cycle data is hidden
          from everyone — please ask the hiring lead to bind one.
        </p>
        <Link
          to="/"
          className="inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Open home
        </Link>
      </div>
    );
  }

  if (state.status === "signed") {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-green-600" />
          <h1 className="text-2xl font-bold text-foreground">
            You have signed the confidentiality agreement
          </h1>
        </div>
        <p className="text-muted-foreground">
          You have already signed the current version of the confidentiality
          agreement for {cycle.name}.
        </p>
        {next && (
          <Link
            to={next}
            className="inline-block px-4 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
          >
            Continue
          </Link>
        )}
      </div>
    );
  }

  // unsigned
  const empty = !agreementVersion || isEmptyBody(agreementVersion.body);

  return (
    <div className="max-w-3xl mx-auto py-10 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-foreground">
          Confidentiality agreement
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        To view sensitive data for the <strong>{cycle.name}</strong> cycle —
        submitted applications, reviews, scheduled interviews, interview notes,
        and decisions — you must read and sign the agreement below. This applies
        to everyone, including hiring leads and admins.
      </p>

      <article className="bg-card border border-border rounded-lg p-6">
        {empty ? (
          <p className="text-sm text-muted-foreground italic">
            The bound agreement has no content yet. Ask the hiring lead to add a
            published version.
          </p>
        ) : (
          <DocEditor
            features="agreement"
            editable={false}
            initialContent={agreementVersion!.body}
            signing={{ mode: "view" }}
          />
        )}
      </article>

      <Form method="post" className="flex items-center justify-end gap-3">
        <input type="hidden" name="intent" value="sign" />
        {next && <input type="hidden" name="next" value={next} />}
        <button
          type="submit"
          disabled={empty}
          className="px-4 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
        >
          I agree and sign
        </button>
      </Form>
    </div>
  );
}
