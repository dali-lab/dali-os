import type { Question } from "~/types";
import { FileUploadField } from "./FileUploadField";
import { SkillsRatingField } from "./SkillsRatingField";
import { UrlCheckIndicator, type UrlCheckState } from "./UrlCheckIndicator";

export function QuestionField({
  question,
  value,
  onChange,
  urlCheckState,
  onUrlBlur,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  urlCheckState?: UrlCheckState;
  onUrlBlur?: () => void;
}) {
  const inputBase =
    "w-full rounded-lg border border-border bg-card text-sm text-dark-blue placeholder:text-muted-foreground/70 focus:outline-none focus:border-accent-coral px-4 py-2";

  if (question.type === "textarea") {
    const wordCount = value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
    const maxWords = question.data.maxWords;
    const overLimit = maxWords !== undefined && wordCount > maxWords;
    return (
      <div>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={4}
          className={`${inputBase} resize-none`}
          placeholder="Your answer"
        />
        <p className={`text-xs mt-1 ${overLimit ? "text-red-500" : "text-muted-foreground"}`}>
          {maxWords !== undefined ? `${wordCount} / ${maxWords} words` : `${wordCount} words`}
        </p>
      </div>
    );
  }

  if (question.type === "select") {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${inputBase} appearance-auto`}
      >
        <option value="">Select...</option>
        {(question.data.options ?? []).map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (question.type === "file") {
    return (
      <FileUploadField
        value={value}
        onChange={onChange}
        accept={question.data.accept}
        questionKey={question.key}
      />
    );
  }

  if (question.type === "skills_rating") {
    return (
      <SkillsRatingField
        skills={question.data.options ?? []}
        value={value}
        onChange={onChange}
      />
    );
  }

  if (question.type === "github_url" || question.type === "figma_url") {
    const placeholder = question.type === "github_url"
      ? "https://github.com/owner/repo"
      : "https://www.figma.com/file/...";
    return (
      <div>
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onUrlBlur}
          className={inputBase}
          placeholder={placeholder}
        />
        {urlCheckState && <UrlCheckIndicator state={urlCheckState} />}
      </div>
    );
  }

  // Default: text
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className={inputBase}
      placeholder="Your answer"
    />
  );
}
