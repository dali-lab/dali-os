import { useRef, useState } from "react";
import type { Question } from "~/types";
import type { SubmissionCheckResult } from "~/hiring/lib/submission-check";
import { countWords } from "~/lib/word-count";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
import { SKILLS_RATING_UNRATED, parseSkillsRating } from "~/hiring/lib/skills-rating";

export type UrlCheckState = {
  status: "idle" | "checking" | "done";
  result?: SubmissionCheckResult;
};

export function UrlCheckIndicator({ state }: { state: UrlCheckState }) {
  if (state.status === "checking") {
    return (
      <span className="text-xs text-muted-foreground/70 flex items-center gap-1 mt-1">
        <span className="inline-block w-3 h-3 border-2 border-border border-t-accent-coral rounded-full animate-spin" />
        Checking URL...
      </span>
    );
  }
  if (state.status === "done" && state.result) {
    if (state.result.status === "valid") {
      return (
        <span className="text-xs text-green-600 flex items-center gap-1 mt-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {state.result.message}
        </span>
      );
    }
    return (
      <span className="text-xs text-amber-600 flex items-center gap-1 mt-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {state.result.message}
      </span>
    );
  }
  return null;
}

// Multi-select over the question's options. Like SkillsRatingField, the
// answer state stays a string: "" when nothing is checked (so the shared
// required-answer check treats it as unanswered), else a JSON-stringified
// array of the selected options in option order. The server re-parses and
// stores a real string[] (validateAnswers in app/forms/lib/public-form.ts).
function CheckboxField({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  let selected: string[] = [];
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        selected = parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      // Unparseable state — treat as nothing selected.
    }
  }

  function toggle(option: string) {
    const next = selected.includes(option)
      ? selected.filter((o) => o !== option)
      : options.filter((o) => selected.includes(o) || o === option);
    onChange(next.length === 0 ? "" : JSON.stringify(next));
  }

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? "opacity-60" : ""}`}>
      {options.map((option) => (
        <label
          key={option}
          className={`flex items-start gap-2 text-base sm:text-sm text-dark-blue ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={selected.includes(option)}
            onChange={() => toggle(option)}
            disabled={disabled}
            className="mt-0.5 w-4 h-4 rounded border-border text-accent-coral focus:ring-accent-coral/30"
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function SkillsRatingField({
  skills,
  value,
  onChange,
  disabled = false,
}: {
  skills: string[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const ratings = parseSkillsRating(value);

  function setRating(skill: string, rating: string) {
    const updated = { ...ratings, [skill]: rating };
    const serialized = skills
      .map(s => `${s}: ${updated[s] ?? SKILLS_RATING_UNRATED}`)
      .join("\n");
    onChange(serialized);
  }

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 ${disabled ? "opacity-60" : ""}`}>
      {skills.map(skill => {
        const current = ratings[skill] ?? SKILLS_RATING_UNRATED;
        const showUnrated = current === SKILLS_RATING_UNRATED;
        return (
          <div key={skill} className="flex items-center justify-between gap-2 py-1">
            <span className="text-sm text-dark-blue truncate">{skill}</span>
            <select
              value={current}
              onChange={e => setRating(skill, e.target.value)}
              disabled={disabled}
              aria-disabled={disabled || undefined}
              className={`w-14 shrink-0 rounded-md border border-border bg-card text-base sm:text-sm text-center text-dark-blue py-1 focus:outline-none focus:border-accent-coral ${disabled ? "cursor-not-allowed" : ""}`}
            >
              {showUnrated && (
                <option value={SKILLS_RATING_UNRATED}>{SKILLS_RATING_UNRATED}</option>
              )}
              {["0", "1", "2", "3", "4", "5"].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function FileUploadField({
  value,
  onChange,
  accept,
  questionKey,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  accept?: string;
  questionKey: string;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileName = value ? value.split("/").pop() ?? "Uploaded file" : null;

  async function handleFile(file: File) {
    setError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (max ${MAX_UPLOAD_LABEL})`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (!fileMatchesAccept(file.name, file.type, accept)) {
      setError(
        accept
          ? `File type not allowed. Accepted: ${accept}`
          : "File type not allowed",
      );
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `applications/${questionKey}/${crypto.randomUUID()}-${file.name}`,
          contentType: file.type || 'application/octet-stream',
          contentLength: file.size,
          accept,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try { message = JSON.parse(text).error ?? message; } catch {}
        throw new Error(message);
      }
      const { url, fields, key } = await presignRes.json();

      const formData = new FormData();
      for (const [name, value] of Object.entries(fields as Record<string, string>)) {
        formData.append(name, value);
      }
      formData.append("file", file);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        const body = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 403 && /EntityTooLarge/i.test(body)) {
          throw new Error(`File too large (max ${MAX_UPLOAD_LABEL})`);
        }
        throw new Error("Upload failed");
      }

      onChange(key);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  if (uploading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-card text-sm text-muted-foreground">
        <span className="inline-block w-4 h-4 border-2 border-border border-t-accent-coral rounded-full animate-spin" />
        Uploading...
      </div>
    );
  }

  if (fileName) {
    return (
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card ${disabled ? "opacity-60" : ""}`}>
        <svg className="w-5 h-5 text-accent-coral shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm text-dark-blue truncate flex-1">{fileName}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (disabled) return; onChange(""); if (fileRef.current) fileRef.current.value = ""; }}
          className={`text-xs text-muted-foreground transition ${disabled ? "cursor-not-allowed" : "hover:text-red-500"}`}
        >
          Remove
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (disabled) return; fileRef.current?.click(); }}
          className={`text-xs text-accent-coral transition ${disabled ? "cursor-not-allowed" : "hover:text-accent-coral/80"}`}
        >
          Replace
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          disabled={disabled}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className={disabled ? "opacity-60" : ""}>
      <button
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        onClick={() => { if (disabled) return; fileRef.current?.click(); }}
        className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border bg-card text-sm text-muted-foreground transition w-full ${disabled ? "cursor-not-allowed" : "hover:border-accent-coral hover:text-accent-coral"}`}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Choose file to upload
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export interface ChallengeQuestionFieldProps {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  urlCheckState?: UrlCheckState;
  onUrlBlur?: () => void;
  disabled?: boolean;
}

export function ChallengeQuestionField({
  question,
  value,
  onChange,
  urlCheckState,
  onUrlBlur,
  disabled = false,
}: ChallengeQuestionFieldProps) {
  const inputBase =
    "w-full rounded-lg border border-border bg-card text-base sm:text-sm text-dark-blue placeholder:text-muted-foreground/70 focus:outline-none focus:border-accent-coral px-4 py-2";
  const disabledClass = disabled ? " opacity-60 cursor-not-allowed" : "";

  if (question.type === "textarea") {
    const wordCount = countWords(value);
    const maxWords = question.data.maxWords;
    const overLimit = maxWords !== undefined && wordCount > maxWords;
    return (
      <div>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={4}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          className={`${inputBase} resize-none${disabledClass}`}
          placeholder="Your answer"
        />
        {/* Only meaningful against a limit — an unbounded "0 words" is noise. */}
        {maxWords !== undefined && (
          <p className={`text-xs mt-1 ${overLimit ? "text-red-500" : "text-muted-foreground"}`}>
            {wordCount} / {maxWords} words
          </p>
        )}
      </div>
    );
  }

  if (question.type === "select") {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={`${inputBase} appearance-auto${disabledClass}`}
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

  if (question.type === "checkbox") {
    return (
      <CheckboxField
        options={question.data.options ?? []}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (question.type === "reference") {
    // Options were resolved server-side from the question's data source.
    // The visible label differs from the stored value (a DB id).
    const opts = question.data.referenceOptions ?? [];
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled || opts.length === 0}
        aria-disabled={disabled || opts.length === 0 || undefined}
        className={`${inputBase} appearance-auto${disabledClass}`}
      >
        <option value="">
          {opts.length === 0 ? "No options available" : "Select..."}
        </option>
        {opts.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
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
        disabled={disabled}
      />
    );
  }

  if (question.type === "skills_rating") {
    return (
      <SkillsRatingField
        skills={question.data.options ?? []}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }

  if (
    question.type === "github_url" ||
    question.type === "figma_url" ||
    question.type === "drive_url"
  ) {
    const placeholder =
      question.type === "github_url"
        ? "https://github.com/owner/repo"
        : question.type === "figma_url"
          ? "https://www.figma.com/file/..."
          : "https://drive.google.com/file/d/...";
    return (
      <div>
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onUrlBlur}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          className={`${inputBase}${disabledClass}`}
          placeholder={placeholder}
        />
        {urlCheckState && <UrlCheckIndicator state={urlCheckState} />}
      </div>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={`${inputBase}${disabledClass}`}
      placeholder="Your answer"
    />
  );
}
