interface EducationQuestion {
  prompt: string;
  type: "Text" | "Url" | "File";
}

interface EducationAnswerDisplayProps {
  question: EducationQuestion;
  answer: string;
}

export function EducationAnswerDisplay({ question, answer }: EducationAnswerDisplayProps) {
  if (!answer?.trim()) {
    return <span className="text-muted-foreground italic">—</span>;
  }

  if (question.type === "Url") {
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

  if (question.type === "File") {
    // answer is a presigned download URL (presigned in the loader before reaching here)
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
        <svg
          className="w-4 h-4 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
          />
        </svg>
        {filename ?? "Download file"}
      </a>
    );
  }

  // Text (default)
  return <p className="text-sm text-dark-blue whitespace-pre-wrap">{answer}</p>;
}
