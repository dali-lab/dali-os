import { useState } from "react";
import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/intern-to-full";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { reconcileDomainApplications } from "~/hiring/lib/domain-application";
import {
  isInternToFullEligible,
  currentInternDomains,
} from "~/hiring/lib/intern-eligibility";
import type { Question } from "~/types";
import { ChallengeQuestionField } from "~/hiring/components/ChallengeQuestionField";

export const meta: Route.MetaFunction = () => [
  { title: "Fellowship · DALI OS" },
];

// This route is the *internal* applicant portal for InternToFull cycles. It
// lives under the authenticated app layout (Google OAuth member session) and
// is intentionally not reachable from the CAS-authed /portal flow — that
// flow exists for external applicants and conflates user identities we
// already have established for current interns.

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const member = await requireMember(auth.user.sub);
  if (!member) {
    return { reason: "not-member" as const };
  }

  const eligible = await isInternToFullEligible(auth.user.sub);
  if (!eligible) {
    return { reason: "not-eligible" as const };
  }

  const internDomains = await currentInternDomains(auth.user.sub);

  const active = await getActiveCycle("InternToFull");
  if (!active) {
    return { reason: "no-active-cycle" as const, internDomains };
  }

  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: active.id },
    include: {
      internToFullFormVersion: true,
      domains: { include: { domain: true } },
    },
  });
  if (!cycle || !cycle.internToFullFormVersion) {
    return { reason: "no-active-cycle" as const, internDomains };
  }

  const draft = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: active.id },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: { select: { id: true, domainId: true, selected: true } },
    },
  });
  const status = draft?.statusUpdates[0]?.newStatus ?? null;

  return {
    reason: "ok" as const,
    cycle: {
      id: cycle.id,
      name: cycle.name,
      currentStatus: active.currentStatus,
      closeDate: cycle.closeDate ? cycle.closeDate.toISOString() : null,
      formVersionId: cycle.internToFullFormVersionId!,
      questions: (cycle.internToFullFormVersion.questions as unknown as Question[]) ?? [],
      targetDomains: cycle.domains.map((d) => ({
        id: d.domainId,
        code: d.domain.code,
        displayName: d.domain.displayName,
      })),
    },
    internDomains,
    draft: draft
      ? {
          id: draft.id,
          status,
          answers: (draft.answers as Record<string, string>) ?? {},
          selectedDomainIds: draft.domainApplications
            .filter((da) => da.selected && da.domainId)
            .map((da) => da.domainId as string),
        }
      : null,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const member = await requireMember(auth.user.sub);
  if (!member) return Response.json({ error: "Not a lab member" }, { status: 403 });

  if (!(await isInternToFullEligible(auth.user.sub))) {
    return Response.json({ error: "Not eligible" }, { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const active = await getActiveCycle("InternToFull");
  if (!active) return Response.json({ error: "No active cycle" }, { status: 404 });
  if (active.currentStatus !== "Open" && intent !== "withdraw") {
    return Response.json({ error: "Cycle is not open" }, { status: 409 });
  }

  if (intent === "save-draft" || intent === "submit") {
    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: active.id },
      include: {
        internToFullFormVersion: true,
        domains: { select: { domainId: true } },
      },
    });
    if (!cycle.internToFullFormVersionId || !cycle.internToFullFormVersion) {
      return Response.json({ error: "Cycle is not configured" }, { status: 409 });
    }
    const formVersionId = cycle.internToFullFormVersionId;
    const questions = (cycle.internToFullFormVersion.questions as unknown as Question[]) ?? [];
    const allowedDomainIds = new Set(cycle.domains.map((d) => d.domainId));

    const answers = JSON.parse((formData.get("answers") as string) || "{}") as Record<string, string>;
    const selectedDomainIds = (JSON.parse(
      (formData.get("selectedDomainIds") as string) || "[]",
    ) as string[]).filter((id) => allowedDomainIds.has(id));

    if (intent === "submit") {
      const missing = questions
        .filter((q) => q.type !== "info" && q.required && !isAnswered(answers[q.key]))
        .map((q) => q.data.label || q.key);
      if (missing.length > 0) {
        return Response.json(
          { error: `Please answer all required questions (${missing.length} unanswered).` },
          { status: 400 },
        );
      }
      if (selectedDomainIds.length === 0) {
        return Response.json(
          { error: "Select at least one target domain before submitting." },
          { status: 400 },
        );
      }
    }

    // Upsert the Application (one per user+cycle). For InternToFull we pin the
    // shortform version on create and never re-pin on subsequent saves — same
    // pattern as Standard's generalChallengeVersionId.
    const application = await prisma.application.upsert({
      where: {
        userId_applicationCycleId: {
          userId: auth.user.sub,
          applicationCycleId: active.id,
        },
      },
      update: { answers },
      create: {
        userId: auth.user.sub,
        applicationCycleId: active.id,
        applicationType: "InternToFull",
        internToFullFormVersionId: formVersionId,
        answers,
        statusUpdates: {
          create: { newStatus: "Draft", userId: auth.user.sub },
        },
      },
    });

    await reconcileDomainApplications({
      applicationId: application.id,
      domainIds: selectedDomainIds,
    });

    if (intent === "submit") {
      const alreadySubmitted = await prisma.applicationStatusUpdate.findFirst({
        where: { applicationId: application.id, newStatus: "Submitted" },
      });
      if (!alreadySubmitted) {
        await prisma.applicationStatusUpdate.create({
          data: {
            applicationId: application.id,
            newStatus: "Submitted",
            userId: auth.user.sub,
          },
        });
      }
      return { submitted: true };
    }

    return { saved: true };
  }

  if (intent === "withdraw") {
    const application = await prisma.application.findFirst({
      where: { userId: auth.user.sub, applicationCycleId: active.id },
    });
    if (!application) {
      return Response.json({ error: "No application found" }, { status: 404 });
    }
    const alreadyWithdrawn = await prisma.applicationStatusUpdate.findFirst({
      where: { applicationId: application.id, newStatus: "Withdrawn" },
    });
    if (alreadyWithdrawn) return { withdrawn: true };
    await prisma.applicationStatusUpdate.create({
      data: {
        applicationId: application.id,
        newStatus: "Withdrawn",
        userId: auth.user.sub,
      },
    });
    return { withdrawn: true };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function isAnswered(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

// ─── UI ──────────────────────────────────────────────────────────────────────

export default function InternToFullRoute() {
  const data = useLoaderData<typeof loader>();

  if (data.reason === "not-member") {
    return <Message title="Not available">This page is only available to current DALI members.</Message>;
  }
  if (data.reason === "not-eligible") {
    return (
      <Message title="Not eligible">
        Fellowship applications are only open to members currently in an intern-program
        domain (ERAS, EEJUST, WISP) during an active term.
      </Message>
    );
  }
  if (data.reason === "no-active-cycle") {
    return (
      <Message title="No open fellowship cycle">
        There's no fellowship application cycle open right now. The hiring
        leads will let interns know when one opens.
      </Message>
    );
  }

  const { cycle, internDomains, draft } = data;
  const submitted = draft?.status === "Submitted";
  const withdrawn = draft?.status === "Withdrawn";

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <header className="mb-8">
        <h1 className="font-heading text-2xl font-bold text-dark-blue mb-1">
          Fellowship Application
        </h1>
        <p className="text-sm text-muted-foreground">
          {cycle.name}
          {cycle.closeDate &&
            ` · closes ${new Date(cycle.closeDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}`}
        </p>
        {internDomains.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            You're currently in{" "}
            {internDomains.map((d, i) => (
              <span key={d.id}>
                <span className="font-medium text-dark-blue">{d.displayName}</span>
                {i < internDomains.length - 1 ? ", " : ""}
              </span>
            ))}
            .
          </p>
        )}
      </header>

      {withdrawn ? (
        <Message title="Application withdrawn">
          You withdrew this fellowship application. Contact the hiring lead if you
          want to reopen it.
        </Message>
      ) : submitted ? (
        <SubmittedView draftId={draft!.id} />
      ) : (
        <FormView cycle={cycle} initial={draft ?? { answers: {}, selectedDomainIds: [] }} />
      )}
    </div>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-6 text-center">
      <h2 className="font-heading text-xl font-bold text-dark-blue mb-2">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
      <Link to="/" className="mt-6 inline-block text-sm text-accent-coral hover:underline">
        ← Back to home
      </Link>
    </div>
  );
}

type CycleData = NonNullable<ReturnType<typeof useLoaderData<typeof loader>> extends { cycle: infer T } ? T : never>;

function FormView({
  cycle,
  initial,
}: {
  cycle: {
    id: string;
    questions: Question[];
    targetDomains: { id: string; code: string; displayName: string }[];
  };
  initial: { answers: Record<string, string>; selectedDomainIds: string[] };
}) {
  const fetcher = useFetcher();
  const [answers, setAnswers] = useState<Record<string, string>>(initial.answers);
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>(initial.selectedDomainIds);
  const [error, setError] = useState<string | null>(null);

  const busy = fetcher.state !== "idle";
  const justSaved = fetcher.data && "saved" in fetcher.data && fetcher.state === "idle";
  const submitted = fetcher.data && "submitted" in fetcher.data;

  function submitForm(intent: "save-draft" | "submit") {
    setError(null);
    fetcher.submit(
      {
        intent,
        answers: JSON.stringify(answers),
        selectedDomainIds: JSON.stringify(selectedDomainIds),
      },
      { method: "post" },
    );
  }

  // Surface server-side validation errors.
  if (fetcher.data && "error" in fetcher.data && fetcher.data.error && error !== fetcher.data.error) {
    setError(fetcher.data.error as string);
  }
  if (submitted) {
    return <SubmittedView />;
  }

  function toggleDomain(id: string) {
    setSelectedDomainIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
          Target domains
        </h2>
        <p className="text-xs text-muted-foreground mb-3">
          Pick the domain(s) you'd like to be considered for. You can pick more than one.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {cycle.targetDomains.map((d) => {
            const checked = selectedDomainIds.includes(d.id);
            return (
              <label
                key={d.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition ${
                  checked
                    ? "border-accent-coral bg-accent-coral/10"
                    : "border-border hover:border-accent-coral/50"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDomain(d.id)}
                  className="w-4 h-4 accent-accent-coral"
                />
                <span className="text-sm font-medium text-dark-blue">{d.displayName}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
          Questions
        </h2>
        <div className="space-y-5">
          {cycle.questions.map((q) => {
            if (q.type === "info") {
              return (
                <div
                  key={q.key}
                  className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground whitespace-pre-wrap"
                >
                  {q.data.body ?? ""}
                </div>
              );
            }
            return (
              <div key={q.key}>
                <label className="block text-sm font-semibold text-dark-blue mb-1">
                  {q.data.label}
                  {q.required && <span className="text-accent-coral ml-0.5">*</span>}
                </label>
                {q.data.description && (
                  <p className="text-xs text-muted-foreground mb-1">{q.data.description}</p>
                )}
                <ChallengeQuestionField
                  question={q}
                  value={answers[q.key] ?? ""}
                  onChange={(v) => setAnswers((prev) => ({ ...prev, [q.key]: v }))}
                />
              </div>
            );
          })}
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {justSaved && !error && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Draft saved.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => submitForm("save-draft")}
          disabled={busy}
          className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
        >
          {busy && fetcher.formData?.get("intent") === "save-draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => submitForm("submit")}
          disabled={busy}
          className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
        >
          {busy && fetcher.formData?.get("intent") === "submit" ? "Submitting…" : "Submit"}
        </button>
      </div>
    </div>
  );
}

function SubmittedView({ draftId }: { draftId?: string } = {}) {
  const fetcher = useFetcher();
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-green-200 bg-green-50/50 px-6 py-8 text-center">
        <h2 className="font-heading text-xl font-bold text-dark-blue mb-2">
          Submitted
        </h2>
        <p className="text-sm text-muted-foreground">
          Your fellowship application is in. Hiring leads will review it and reach out
          with a decision.
        </p>
      </div>
      <div className="flex justify-end">
        {confirming ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-2">
            <p className="text-sm font-semibold text-red-700">Withdraw this application?</p>
            <p className="text-xs text-red-600/80">You can't reopen it without contacting the hiring lead.</p>
            <div className="flex gap-3">
              <button
                onClick={() => fetcher.submit({ intent: "withdraw" }, { method: "post" })}
                disabled={busy}
                className="px-4 py-1.5 rounded-full bg-red-600 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Withdrawing…" : "Yes, withdraw"}
              </button>
              <button onClick={() => setConfirming(false)} className="text-sm text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="text-sm text-muted-foreground hover:text-red-600 hover:underline"
          >
            Withdraw application
          </button>
        )}
      </div>
    </div>
  );
}
