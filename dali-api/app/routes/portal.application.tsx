import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/portal.application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getActiveCycleById } from "~/hiring/lib/cycles";
import { presignAnswers } from "~/hiring/lib/presign";
import type { Question } from "~/types";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { QuestionList } from "~/hiring/components/ApplicationAnswers";
import { sendInterviewCancelEmails } from "~/hiring/lib/interview-emails";

export const meta: Route.MetaFunction = () => [{ title: "My application · DALI OS" }];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  // ?cycle=<id> names which of my applications to show (several cycles can be
  // active at once); without it, my most recent one.
  const requested = new URL(request.url).searchParams.get("cycle");
  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, ...(requested && { applicationCycleId: requested }) },
    orderBy: { createdAt: "desc" },
    include: {
      statusUpdates: { orderBy: { createdAt: "asc" } },
      applicationFormVersion: { select: { questions: true } },
      domainApplications: {
        where: { selected: true },
        include: {
          challengeFormVersion: { select: { questions: true } },
          domain: true,
        },
      },
    },
  });

  // Need at least one Submitted update to render this page. Withdrawn is allowed
  // (and renders the withdrawn-state view); Draft alone redirects back to /portal.
  const submittedUpdate = application?.statusUpdates.find((u: any) => u.newStatus === "Submitted");
  if (!application || !submittedUpdate) return redirect("/portal");

  const latestUpdate = application.statusUpdates[application.statusUpdates.length - 1];
  const isWithdrawn = latestUpdate?.newStatus === "Withdrawn";
  const withdrawnUpdate = isWithdrawn ? latestUpdate : null;
  const active = await getActiveCycleById(application.applicationCycleId);
  const canWithdraw = !!active && !isWithdrawn;

  const generalQuestions =
    (application.applicationFormVersion?.questions as unknown as Question[]) ?? [];
  const rawGeneralAnswers = application.answers as Record<string, string>;
  const generalAnswers = await presignAnswers(generalQuestions, rawGeneralAnswers);

  const domains = await Promise.all(
    application.domainApplications.map(async (da: any) => {
      const questions = (da.challengeFormVersion?.questions ?? []) as unknown as Question[];
      const rawAnswers = da.answers as Record<string, string>;
      const answers = await presignAnswers(questions, rawAnswers);
      return {
        id: da.id,
        name: da.domain?.name ?? "Unknown Domain",
        questions,
        answers,
      };
    }),
  );

  return {
      cycleId: application.applicationCycleId,
      submittedAt: submittedUpdate.createdAt.toISOString(),
      withdrawnAt: withdrawnUpdate?.createdAt.toISOString() ?? null,
      canWithdraw,
      generalQuestions,
      generalAnswers,
      domains,
    };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent !== "withdraw") {
    return Response.json({ error: "Unknown intent" }, { status: 400 });
  }

  // Withdrawal targets the posted cycle, and only while that cycle is active.
  const active = await getActiveCycleById(String(formData.get("cycleId") ?? ""));
  if (!active) {
    return Response.json({ error: "No active cycle" }, { status: 400 });
  }

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: active.id },
    include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (!application) {
    return Response.json({ error: "No application found" }, { status: 404 });
  }

  const latest = application.statusUpdates[0]?.newStatus;
  if (latest !== "Submitted") {
    return Response.json(
          { error: latest === "Withdrawn" ? "Already withdrawn" : "Application is not submitted" },
          { status: 400 },
        );
  }

  const cancelledInterviews = await prisma.$transaction(async (tx) => {
    await tx.applicationStatusUpdate.create({
      data: {
        applicationId: application.id,
        userId: auth.user.sub,
        newStatus: "Withdrawn",
      },
    });

    const scheduled = await tx.interview.findMany({
      where: {
        status: "Scheduled",
        applicationCycleId: active.id,
        domainApplication: { applicationId: application.id },
      },
      select: { id: true, domainApplicationId: true },
    });

    if (scheduled.length > 0) {
      const ids = scheduled.map((i) => i.id);
      await tx.interview.updateMany({
        where: { id: { in: ids } },
        data: { status: "CancelledByApplicant" },
      });
      await tx.interviewAssignment.updateMany({
        where: { interviewId: { in: ids }, status: "Active" },
        data: { status: "Declined" },
      });
    }

    return scheduled;
  });

  for (const { id, domainApplicationId } of cancelledInterviews) {
    sendInterviewCancelEmails(id, domainApplicationId).catch(() => {});
  }

  return Response.json({ ok: true });
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
    <details className="group rounded-os-card border border-border overflow-hidden">
      <summary className="flex items-center justify-between px-6 py-4 bg-os-card cursor-pointer list-none select-none">
        <span className="font-heading text-base font-bold text-foreground">{name}</span>
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
  const { cycleId, submittedAt, withdrawnAt, canWithdraw, generalQuestions, generalAnswers, domains } =
    useLoaderData<typeof loader>() as {
      cycleId: string;
      submittedAt: string;
      withdrawnAt: string | null;
      canWithdraw: boolean;
      generalQuestions: Question[];
      generalAnswers: Record<string, string>;
      domains: { id: string; name: string; questions: Question[]; answers: Record<string, string> }[];
    };

  const isWithdrawn = withdrawnAt !== null;
  const dialog = useDialog();
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

  async function withdraw() {
    const ok = await dialog.confirm({
      title: "Withdraw your application?",
      description:
        "Your application comes out of review. You can't undo this from the portal — you'd need to contact the DALI team to reverse it.",
      confirmLabel: "Withdraw",
      cancelLabel: "Keep it in review",
      tone: "destructive",
    });
    if (!ok) return;
    const form = new FormData();
    form.set("intent", "withdraw");
    form.set("cycleId", cycleId);
    withdrawFetcher.submit(form, { method: "post" });
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-os-card px-6 py-10">
        <div>
          <Link
            to={`/portal/hiring?cycle=${cycleId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-os-accent transition mb-4"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to portal
          </Link>
          <h1 className="font-heading text-4xl font-medium text-foreground">Your Application</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Submitted {submittedDate} — this view reflects your most recently saved answers.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-10">
        <div className="space-y-8">
          {/* Withdrawn notice OR withdraw action */}
          {isWithdrawn ? (
            <div
              role="status"
              className="rounded-os-card border border-border bg-muted/30 px-6 py-5 flex items-start gap-3"
            >
              <svg className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  You withdrew this application on {withdrawnDate}.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your answers are preserved below for reference. If you change your mind, contact the DALI team.
                </p>
              </div>
            </div>
          ) : canWithdraw ? (
            <div className="rounded-os-card border border-border px-6 py-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">No longer want to be considered?</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Withdrawing removes your application from review. This cannot be undone from the portal.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void withdraw()}
                disabled={submittingWithdraw}
                className={buttonClasses("secondary", "md", "shrink-0")}
              >
                {submittingWithdraw ? "Withdrawing…" : "Withdraw Application"}
              </button>
            </div>
          ) : null}

          {/* General questions */}
          <div className="rounded-os-card bg-os-card px-6 py-5">
            <h2 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider mb-5">
              General Questions
            </h2>
            <QuestionList questions={generalQuestions} answers={generalAnswers} />
          </div>

          {/* Domain sections */}
          {domains.length > 0 && (
            <div className="space-y-4">
              <h2 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider">
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

    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
