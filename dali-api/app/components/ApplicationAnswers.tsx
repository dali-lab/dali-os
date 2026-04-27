import type { Question } from "~/types";

export function renderSkillsRating(value: string): React.ReactNode {
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

export interface AnswerDisplayProps {
  question: Question;
  answer: string;
  /**
   * When true, file answers are presigned download URLs and render as a
   * clickable link. When false, the answer is a raw S3 key (e.g. on the apply
   * page's pre-submit review) and only the filename is shown.
   */
  presigned?: boolean;
}

export function AnswerDisplay({ question, answer, presigned = true }: AnswerDisplayProps) {
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
    if (!presigned) {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-dark-blue">
          <svg className="w-4 h-4 shrink-0 text-accent-coral" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          {filename ?? "Uploaded file"}
        </span>
      );
    }
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

  return <p className="text-sm text-dark-blue whitespace-pre-wrap">{answer}</p>;
}

export interface QuestionListProps {
  questions: Question[];
  answers: Record<string, string>;
  presigned?: boolean;
}

export function QuestionList({ questions, answers, presigned = true }: QuestionListProps) {
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
          <AnswerDisplay question={q} answer={answers[q.key] ?? ""} presigned={presigned} />
        </div>
      ))}
    </div>
  );
}
