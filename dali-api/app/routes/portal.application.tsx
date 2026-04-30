import { useState } from "react";
import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/portal.application";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { getDownloadUrl } from "~/lib/s3";
import type { Question } from "~/types";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { Modal } from "~/components/Modal";
import { QuestionList } from "~/hiring/components/ApplicationAnswers";

export const meta: Route.MetaFunction = () => [{ title: "My application · DALI OS" }];

// ─── Loader ──────────────────────────────────────────────────────────────────

async function presignAnswers(
  questions: Question[],
  answers: Record<string, string>,
): Promise<Record<string, string>> {
  const result = { ...answers };
  for (const q of questions) {
    if (q.type === "file" && answers[q.key]?.trim()) {
      try {
        result[q.key] = await getDownloadUrl(answers[q.key], 900);
      } catch {
        // If presign fails, keep the raw key so the UI can still show something
      }
    }
  }
  return result;
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const active = await getActiveCycle();
  let cycleId: string;

  if (active) {
    cycleId = active.id;
  } else {
    const recentApp = await prisma.application.findFirst({
      where: { userId: auth.user.sub },
      orderBy: { createdAt: "desc" },
      select: { applicationCycleId: true },
    });
    if (!recentApp) return withAuth(auth, redirect("/portal"));
    cycleId = recentApp.applicationCycleId;
  }

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: cycleId },
    include: {
      statusUpdates: { orderBy: { createdAt: "asc" } },
      generalChallengeVersion: { select: { questions: true } },
      domainApplications: {
        where: { selected: true },
        include: {
          challengeVersion: {
            select: { questions: true, domain: true },
          },
        },
      },
    },
  });

  // Need at least one Submitted update to render this page. Withdrawn is allowed
  // (and renders the withdrawn-state view); Draft alone redirects back to /portal.
  const submittedUpdate = application?.statusUpdates.find((u: any) => u.newStatus === "Submitted");
  if (!application || !submittedUpdate) return withAuth(auth, redirect("/portal"));

  const latestUpdate = application.statusUpdates[application.statusUpdates.length - 1];
  const isWithdrawn = latestUpdate?.newStatus === "Withdrawn";
  const withdrawnUpdate = isWithdrawn ? latestUpdate : null;
  const canWithdraw = !!active && !isWithdrawn;

  const generalQuestions = application.generalChallengeVersion.questions as unknown as Question[];
  const rawGeneralAnswers = application.answers as Record<string, string>;
  const generalAnswers = await presignAnswers(generalQuestions, rawGeneralAnswers);

  const domains = await Promise.all(
    application.domainApplications.map(async (da: any) => {
      const questions = da.challengeVersion.questions as unknown as Question[];
      const rawAnswers = da.answers as Record<string, string>;
      const answers = await presignAnswers(questions, rawAnswers);
      return {
        id: da.id,
        name: da.challengeVersion.domain?.name ?? "Unknown Domain",
        questions,
        answers,
      };
    }),
  );

  return withAuth(auth, {
      submittedAt: submittedUpdate.createdAt.toISOString(),
      withdrawnAt: withdrawnUpdate?.createdAt.toISOString() ?? null,
      canWithdraw,
      generalQuestions,
      generalAnswers,
      domains,
    });
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "withdraw") {
    return withAuth(auth, Response.json({ error: "Unknown intent" }, { status: 400 }));
  }

  const active = await getActiveCycle();
  if (!active) {
    return withAuth(auth, Response.json({ error: "No active cycle" }, { status: 400 }));
  }

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: active.id },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!application) {
    return withAuth(auth, Response.json({ error: "No application found" }, { status: 404 }));
  }

  const latest = application.statusUpdates[0]?.newStatus;
  if (latest !== "Submitted") {
    return withAuth(auth, Response.json(
          { error: latest === "Withdrawn" ? "Already withdrawn" : "Application is not submitted" },
          { status: 400 },
        ));
  }

  await prisma.applicationStatusUpdate.create({
    data: {
      applicationId: application.id,
      userId: auth.user.sub,
      newStatus: "Withdrawn",
    },
  });

  return withAuth(auth, Response.json({ ok: true }));
}

// ─── Domain section (collapsible) ────────────────────────────────────────────

function DomainSection({
  name,
  questions,
  answers,
}: {
  name: string;
  questions: Question[];
  answers: Record<string, string>;
}) {
  return (
    <details className="group rounded-2xl border border-border overflow-hidden">
      <summary className="flex items-center justify-between px-6 py-4 bg-[#E8F4FA] cursor-pointer list-none select-none">
        <span className="font-heading text-base font-bold text-dark-blue">{name}</span>
        <svg
          className="w-5 h-5 text-muted-foreground transition-transform group-open:rotate-180"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </summary>
      <div className="px-6 py-5">
        <QuestionList questions={questions} answers={answers} />
      </div>
    </details>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PortalApplication() {
  const { submittedAt, withdrawnAt, canWithdraw, generalQuestions, generalAnswers, domains } =
    useLoaderData<typeof loader>() as {
      submittedAt: string;
      withdrawnAt: string | null;
      canWithdraw: boolean;
      generalQuestions: Question[];
      generalAnswers: Record<string, string>;
      domains: { id: string; name: string; questions: Question[]; answers: Record<string, string> }[];
    };

  const isWithdrawn = withdrawnAt !== null;
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const withdrawFetcher = useFetcher();
  const submittingWithdraw = withdrawFetcher.state !== "idle";

  const submittedDate = new Date(submittedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const withdrawnDate = withdrawnAt
    ? new Date(withdrawnAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  function confirmWithdraw() {
    const form = new FormData();
    form.set("intent", "withdraw");
    withdrawFetcher.submit(form, { method: "post" });
    setShowWithdrawModal(false);
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-[#E8F4FA] px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/portal"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-accent-coral transition mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to portal
          </Link>
          <h1 className="font-heading text-xl font-bold text-dark-blue">Your Application</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Submitted {submittedDate} — this view reflects your most recently saved answers.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Withdrawn notice OR withdraw action */}
          {isWithdrawn ? (
            <div
              role="status"
              className="rounded-2xl border border-border bg-muted/30 px-6 py-5 flex items-start gap-3"
            >
              <svg className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-dark-blue">
                  You withdrew this application on {withdrawnDate}.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your answers are preserved below for reference. If you change your mind, contact the DALI team.
                </p>
              </div>
            </div>
          ) : canWithdraw ? (
            <div className="rounded-2xl border border-border px-6 py-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-dark-blue">No longer want to be considered?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Withdrawing removes your application from review. This cannot be undone from the portal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWithdrawModal(true)}
                disabled={submittingWithdraw}
                className="shrink-0 px-5 py-2 rounded-full border-2 border-red-500 text-red-500 text-sm font-semibold hover:bg-red-500 hover:text-white transition disabled:opacity-50"
              >
                Withdraw Application
              </button>
            </div>
          ) : null}

          {/* General questions */}
          <div className="rounded-2xl bg-[#E8F4FA] px-6 py-5">
            <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider mb-5">
              General Questions
            </h2>
            <QuestionList questions={generalQuestions} answers={generalAnswers} />
          </div>

          {/* Domain sections */}
          {domains.length > 0 && (
            <div className="space-y-4">
              <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">
                Domain Questions
              </h2>
              {domains.map(d => (
                <DomainSection
                  key={d.id}
                  name={d.name}
                  questions={d.questions}
                  answers={d.answers}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Withdraw confirmation modal */}
      <Modal
        open={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
        labelledBy="withdraw-modal-title"
        disableEscape={submittingWithdraw}
      >
        <h3 id="withdraw-modal-title" className="font-heading text-base font-bold text-dark-blue mb-2">
          Withdraw your application?
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Your application will be removed from review. You can't undo this from the portal — you'd need to contact the DALI team to reverse it.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            type="button"
            onClick={() => setShowWithdrawModal(false)}
            disabled={submittingWithdraw}
            className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmWithdraw}
            disabled={submittingWithdraw}
            className="px-5 py-2 rounded-full bg-red-500 text-white text-sm font-semibold hover:bg-red-500/90 transition disabled:opacity-50"
          >
            {submittingWithdraw ? "Withdrawing..." : "Withdraw"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
