import { redirect, useLoaderData, Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/portal.application";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import type { Question } from "~/types";

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const include = {
    statusUpdates: true,
    generalChallengeVersion: { select: { questions: true } },
    domainApplications: {
      include: {
        challengeVersion: {
          include: { domain: true },
        },
      },
    },
  } as const;

  const active = await getActiveCycle();
  let application = active
    ? await prisma.application.findFirst({
        where: { userId: auth.user.sub, applicationCycleId: active.id },
        include,
      })
    : null;

  if (!application) {
    application = await prisma.application.findFirst({
      where: { userId: auth.user.sub },
      include,
      orderBy: { createdAt: "desc" },
    });
  }

  const isSubmitted = application?.statusUpdates.some((u: any) => u.newStatus === "Submitted");
  if (!application || !isSubmitted) return redirect("/portal");

  const generalQuestions =
    (application.generalChallengeVersion?.questions as unknown as Question[]) ?? [];
  const generalAnswers = application.answers as Record<string, string>;

  const domains = (application.domainApplications as any[]).map((da: any) => ({
    name: da.challengeVersion?.domain?.name ?? "Unknown",
    questions: (da.challengeVersion?.questions as unknown as Question[]) ?? [],
    answers: da.answers as Record<string, string>,
  }));

  return { generalQuestions, generalAnswers, domains };
}

// ─── File answer link ────────────────────────────────────────────────────────

function FileAnswerLink({ s3Key }: { s3Key: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const fileName = s3Key.split("/").pop() ?? "Uploaded file";

  useEffect(() => {
    fetch(`/api/upload/url?key=${encodeURIComponent(s3Key)}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUrl(data.url))
      .catch(() => setError(true));
  }, [s3Key]);

  if (error) return <span className="text-sm text-red-500">Could not load file link.</span>;
  if (!url) return <span className="text-sm text-muted-foreground">Loading…</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-accent-coral hover:underline"
    >
      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      {fileName}
    </a>
  );
}

// ─── Answer renderer ─────────────────────────────────────────────────────────

function AnswerDisplay({ question, answer }: { question: Question; answer: string }) {
  if (!answer) {
    return <span className="text-sm text-muted-foreground/60 italic">No answer provided.</span>;
  }

  if (question.type === "github_url" || question.type === "figma_url") {
    return (
      <a
        href={answer}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent-coral hover:underline break-all"
      >
        {answer}
      </a>
    );
  }

  if (question.type === "file") {
    return <FileAnswerLink s3Key={answer} />;
  }

  if (question.type === "skills_rating") {
    const lines = answer
      .split("\n")
      .map(line => {
        const idx = line.lastIndexOf(":");
        if (idx < 0) return null;
        return { skill: line.slice(0, idx).trim(), rating: line.slice(idx + 1).trim() };
      })
      .filter(Boolean) as { skill: string; rating: string }[];

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
        {lines.map(({ skill, rating }) => (
          <div key={skill} className="flex items-center justify-between gap-2 py-0.5">
            <span className="text-sm text-dark-blue truncate">{skill}</span>
            <span className="text-sm font-semibold text-dark-blue shrink-0 w-6 text-right">{rating}</span>
          </div>
        ))}
      </div>
    );
  }

  // text, textarea, select
  return <p className="text-sm text-dark-blue whitespace-pre-wrap">{answer}</p>;
}

// ─── Question block ──────────────────────────────────────────────────────────

function QuestionBlock({ question, answer }: { question: Question; answer: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-dark-blue mb-1">{question.data.label}</p>
      {question.data.description && (
        <p className="text-xs text-muted-foreground mb-1">{question.data.description}</p>
      )}
      <AnswerDisplay question={question} answer={answer} />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortalApplication() {
  const { generalQuestions, generalAnswers, domains } =
    useLoaderData<typeof loader>() as {
      generalQuestions: Question[];
      generalAnswers: Record<string, string>;
      domains: { name: string; questions: Question[]; answers: Record<string, string> }[];
    };

  return (
    <div>
      {/* Header */}
      <div className="bg-[#E8F4FA] px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="font-heading text-xl font-bold text-dark-blue">Your Submitted Application</h1>
          <Link
            to="/portal"
            className="text-sm text-muted-foreground hover:text-accent-coral transition"
          >
            ← Back to portal
          </Link>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* General questions */}
          {generalQuestions.length > 0 && (
            <div className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6">
              <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">
                General Questions
              </h2>
              {generalQuestions.map(q => (
                <QuestionBlock key={q.key} question={q} answer={generalAnswers[q.key] ?? ""} />
              ))}
            </div>
          )}

          {/* Domain-specific questions */}
          {domains.map(domain => (
            <div key={domain.name} className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6">
              <h2 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">
                {domain.name} Questions
              </h2>
              {domain.questions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No questions for this domain.</p>
              ) : (
                domain.questions.map(q => (
                  <QuestionBlock key={q.key} question={q} answer={domain.answers[q.key] ?? ""} />
                ))
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
