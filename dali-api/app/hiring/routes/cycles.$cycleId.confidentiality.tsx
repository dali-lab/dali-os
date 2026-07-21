import { Form, Link, redirect, useLoaderData } from "react-router";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import type { Route } from "./+types/cycles.$cycleId.confidentiality";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { getCycleConfidentialityState } from "~/hiring/lib/confidentiality";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";
import { Button, buttonClasses } from "~/components/ui/Button";

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
    const v = await prisma.confidentialityAgreementVersion.findUnique({
      where: { id: state.activeVersionId },
      include: { agreement: { select: { name: true } } },
    });
    if (v) {
      agreementVersion = {
        id: v.id,
        versionNumber: v.versionNumber,
        body: v.body,
        agreement: { name: v.agreement.name },
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

  const binding = await prisma.cycleConfidentialityAgreement.findUnique({
    where: { applicationCycleId: cycleId },
    select: { confidentialityAgreementVersionId: true },
  });
  if (!binding) {
    return { error: "No confidentiality agreement is bound to this cycle" };
  }

  const versionId = binding.confidentialityAgreementVersionId;
  await prisma.confidentialityAgreementSignature.upsert({
    where: {
      userId_applicationCycleId: {
        userId: auth.user.sub,
        applicationCycleId: cycleId,
      },
    },
    create: {
      userId: auth.user.sub,
      applicationCycleId: cycleId,
      confidentialityAgreementVersionId: versionId,
    },
    update: {
      confidentialityAgreementVersionId: versionId,
      signedAt: new Date(),
    },
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
      <div className="max-w-3xl mx-auto py-10 space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 text-yellow-700">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Nothing to sign yet
          </h1>
        </div>
        <p className="text-muted-foreground">
          The hiring lead hasn't attached a confidentiality agreement to the{" "}
          <strong className="text-foreground">{cycle.name}</strong> cycle yet.
          Until they do, sensitive cycle data stays hidden from everyone. Ask the
          hiring lead to bind one, then come back to sign.
        </p>
        <Link to="/" className={buttonClasses("secondary")}>
          Back to home
        </Link>
      </div>
    );
  }

  if (state.status === "signed") {
    return (
      <div className="max-w-3xl mx-auto py-10 space-y-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-700">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            You're signed in for this cycle
          </h1>
        </div>
        <p className="text-muted-foreground">
          You've already signed the current confidentiality agreement for{" "}
          <strong className="text-foreground">{cycle.name}</strong>. You can
          view its sensitive data.
        </p>
        {next && (
          <Link to={next} className={buttonClasses("primary")}>
            Continue
          </Link>
        )}
      </div>
    );
  }

  // unsigned
  const empty = !agreementVersion || isEmptyDoc(agreementVersion.body);

  return (
    <div className="max-w-3xl mx-auto py-10 space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-accent-coral">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          Read &amp; sign the confidentiality agreement
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Before you can view sensitive data for the{" "}
        <strong className="text-foreground">{cycle.name}</strong> cycle —
        submitted applications, reviews, scheduled interviews, interview notes,
        and decisions — read the agreement below and sign it. This applies to
        everyone, including hiring leads and admins.
      </p>

      <article className="bg-card border border-border rounded-lg p-6">
        {empty ? (
          <p className="text-sm text-muted-foreground italic">
            The bound agreement has no content yet. Ask the hiring lead to add a
            published version.
          </p>
        ) : (
          <RichTextViewer content={agreementVersion!.body} />
        )}
      </article>

      <Form method="post" className="flex items-center justify-end gap-3">
        <input type="hidden" name="intent" value="sign" />
        {next && <input type="hidden" name="next" value={next} />}
        <Button type="submit" variant="primary" disabled={empty}>
          Agree and sign
        </Button>
      </Form>
    </div>
  );
}
