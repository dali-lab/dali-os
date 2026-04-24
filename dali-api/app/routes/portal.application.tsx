import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/portal.application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { getDownloadUrl } from "~/lib/s3";
import type { Question } from "~/types";

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
  if (!auth.ok) return redirect("/login");

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
    if (!recentApp) return redirect("/portal");
    cycleId = recentApp.applicationCycleId;
  }

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: cycleId },
    include: {
      statusUpdates: true,
      generalChallengeVersion: { select: { questions: true } },
      domainApplications: {
        include: {
          challengeVersion: {
            select: { questions: true, domain: true },
          },
        },
      },
    },
  });

  const submittedUpdate = application?.statusUpdates.find((u: any) => u.newStatus === "Submitted");
  if (!application || !submittedUpdate) return redirect("/portal");

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

  return {
    submittedAt: submittedUpdate.createdAt.toISOString(),
    generalQuestions,
    generalAnswers,
    domains,
  };
}

// ─── Answer renderers ────────────────────────────────────────────────────────

function renderSkillsRating(value: string): React.ReactNode {
  const ratings: { skill: string; rating: string }[] = [];
  if (value) {
    for (const line of value.split("\n")) {
      const idx = line.lastIndexOf(":");
      if (idx > 0) {
        ratings.push({ skill: line.slice(0, idx).trim(), rating: line.slice(idx + 1).trim() });
      }
    }
  }
  if (ratings.length === 0) return <span className="text-muted-foreground italic">—</span>;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
      {ratings.map(({ skill, rating }) => (
        <div key={skill} className="flex items-center justify-between gap-2">
          <span className="text-sm text-dark-blue truncate">{skill}</span>
          <span className="shrink-0 w-8 text-center text-sm font-semibold text-dark-blue bg-white rounded border border-border py-0.5">
            {rating}
          </span>
        </div>
      ))}
    </div>
  );
}

function AnswerDisplay({ question, answer }: { question: Question; answer: string }) {
  if (!answer?.trim()) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  if (question.type === "github_url" || question.type === "figma_url") {
    return (
      <a
        href={answer}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent-coral underline underline-offset-2 hover:text-accent-coral/80 break-all"
      >
        {answer}
      </a>
    );
  }

  if (question.type === "file") {
    const filename = answer.includes("?")
      ? answer.split("?")[0].split("/").pop()
      : answer.split("/").pop();
    return (
      <a
        href={answer}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm text-accent-coral underline underline-offset-2 hover:text-accent-coral/80"
      >
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        {filename ?? "Download file"}
      </a>
    );
  }

  if (question.type === "skills_rating") {
    return <>{renderSkillsRating(answer)}</>;
  }

  // text / textarea / select
  return <p className="text-sm text-dark-blue whitespace-pre-wrap">{answer}</p>;
}

// ─── Question list ────────────────────────────────────────────────────────────

function QuestionList({
  questions,
  answers,
}: {
  questions: Question[];
  answers: Record<string, string>;
}) {
  if (questions.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No questions in this section.</p>;
  }
  return (
    <div className="space-y-5">
      {questions.map(q => (
        <div key={q.key}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            {q.data.label}
          </p>
          <AnswerDisplay question={q} answer={answers[q.key] ?? ""} />
        </div>
      ))}
    </div>
  );
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
  const { submittedAt, generalQuestions, generalAnswers, domains } =
    useLoaderData<typeof loader>() as {
      submittedAt: string;
      generalQuestions: Question[];
      generalAnswers: Record<string, string>;
      domains: { id: string; name: string; questions: Question[]; answers: Record<string, string> }[];
    };

  const submittedDate = new Date(submittedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

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
    </div>
  );
}
