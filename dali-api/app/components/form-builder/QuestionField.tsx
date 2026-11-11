import { useRef, useState } from "react";
import { ChevronDown, ExternalLink, Paperclip, Upload } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Radio } from "~/components/ui/Radio";
import type { Question } from "~/types";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import { countWords } from "~/lib/word-count";
import { formUploadKeyPrefix } from "~/lib/file-validation";
import { SKILLS_RATING_UNRATED, parseSkillsRating } from "~/lib/skills-rating";
import type { ReferenceOption } from "~/forms/lib/reference-sources.shared";
import { Combobox, MultiSelect, SEARCH_THRESHOLD, Select } from "~/components/ui/floating";
import { DateField } from "~/components/ui/DateField";
import {
  OTHER_ANSWER_MAX_LENGTH,
  fileAnswerName,
  maxFilesFor,
  parseFileAnswer,
  serializeFileAnswer,
} from "~/lib/form-answers";
import { uploadFileToS3 } from "~/lib/upload-client";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";

const INPUT_BASE =
  "w-full rounded-lg border border-border bg-card text-base sm:text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-os-accent px-4 py-2";

const LONG_CHECKBOX_LIST = 12;

function ChoiceDropdown({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled: boolean;
  placeholder: string;
  className: string;
}) {
  if (options.length > SEARCH_THRESHOLD) {
    return (
      <Combobox
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        options={options}
        className={className}
      />
    );
  }
  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      options={options}
      buttonClassName={`${className} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
    />
  );
}

export type UrlCheckState = {
  status: "idle" | "checking" | "done";
  result?: SubmissionCheckResult;
};

export function UrlCheckIndicator({ state }: { state: UrlCheckState }) {
  if (state.status === "checking") {
    return (
      <span className="text-xs text-muted-foreground/70 flex items-center gap-1 mt-1">
        <span className="inline-block w-3 h-3 border-2 border-border border-t-os-accent rounded-full animate-spin" />
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
  allowOther = false,
  disabled = false,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  allowOther?: boolean;
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
  const chosen = selected.filter((v) => options.includes(v));
  const otherText = selected.find((v) => !options.includes(v)) ?? "";
  const [otherPicked, setOtherPicked] = useState(false);
  const otherOn = allowOther && (otherPicked || otherText !== "");

  function emit(nextChosen: string[], nextOther: string) {
    const next = [
      ...options.filter((o) => nextChosen.includes(o)),
      ...(nextOther.trim() !== "" ? [nextOther] : []),
    ];
    onChange(next.length === 0 ? "" : JSON.stringify(next));
  }

  function toggle(option: string) {
    emit(
      chosen.includes(option) ? chosen.filter((o) => o !== option) : [...chosen, option],
      otherText,
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${disabled ? "opacity-60" : ""}`}>
      {options.length > LONG_CHECKBOX_LIST ? (
        <MultiSelect
          values={chosen}
          onChange={(next) => emit(next, otherText)}
          options={options.map((o) => ({ value: o, label: o }))}
          disabled={disabled}
          placeholder="Select..."
          buttonClassName={`${INPUT_BASE} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
        />
      ) : (
        options.map((option) => (
          <Checkbox
            key={option}
            checked={chosen.includes(option)}
            onChange={() => toggle(option)}
            disabled={disabled}
            label={option}
            className="text-base sm:text-sm text-foreground"
          />
        ))
      )}
      {allowOther && (
        <>
          <Checkbox
            checked={otherOn}
            onChange={() => {
              if (otherOn) {
                setOtherPicked(false);
                emit(chosen, "");
              } else {
                setOtherPicked(true);
              }
            }}
            disabled={disabled}
            label="Other"
            className="text-base sm:text-sm text-foreground"
          />
          {otherOn && (
            <OtherInput
              value={otherText}
              onChange={(text) => emit(chosen, text)}
              disabled={disabled}
            />
          )}
        </>
      )}
    </div>
  );
}

function OtherInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={OTHER_ANSWER_MAX_LENGTH}
      disabled={disabled}
      aria-label="Other answer"
      placeholder="Your answer"
      className="ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-border bg-card text-base sm:text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-os-accent px-4 py-2"
    />
  );
}

// Single choice shown as radio buttons. A stored value that isn't one of the
// options is an Other write-in, so re-rendering a saved answer lands on Other.
function RadioField({
  name,
  options,
  value,
  onChange,
  allowOther = false,
  disabled = false,
}: {
  name: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  allowOther?: boolean;
  disabled?: boolean;
}) {
  const [otherPicked, setOtherPicked] = useState(false);
  const otherOn = allowOther && (otherPicked || (value !== "" && !options.includes(value)));

  return (
    <div role="radiogroup" className={`flex flex-col gap-1.5 ${disabled ? "opacity-60" : ""}`}>
      {options.map((option) => (
        <Radio
          key={option}
          name={name}
          value={option}
          checked={!otherOn && value === option}
          onChange={() => {
            setOtherPicked(false);
            onChange(option);
          }}
          disabled={disabled}
          label={option}
          className="text-base sm:text-sm text-foreground"
        />
      ))}
      {allowOther && (
        <>
          <Radio
            name={name}
            value="__other__"
            checked={otherOn}
            onChange={() => {
              setOtherPicked(true);
              if (options.includes(value)) onChange("");
            }}
            disabled={disabled}
            label="Other"
            className="text-base sm:text-sm text-foreground"
          />
          {otherOn && <OtherInput value={options.includes(value) ? "" : value} onChange={onChange} disabled={disabled} />}
        </>
      )}
    </div>
  );
}

const SCALE_VALUES = ["1", "2", "3", "4", "5"];

function ScaleField({
  value,
  onChange,
  low,
  high,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  low?: string;
  high?: string;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className={disabled ? "opacity-60" : ""}>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-[6px]">
        {SCALE_VALUES.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(n)}
              className={`h-11 rounded-lg border text-base sm:text-sm font-medium transition-colors ${
                selected
                  ? "bg-os-accent/15 border-os-accent text-os-accent"
                  : "bg-card border-border text-foreground hover:border-os-accent/40"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {(low || high) && (
        <div className="mt-1.5 flex justify-between gap-4 text-[13px] text-muted-foreground">
          <span>{low}</span>
          <span className="text-right">{high}</span>
        </div>
      )}
    </div>
  );
}

// One card in the `projects:*` picker. A thumbnail + name + blurb is enough
// to scan the list; per-domain challenges and the SOW link are lower-signal
// (long, term-specific text) so they're tucked behind "View details" rather
// than forcing every card open to a wall of text.
//
// Only the summary is wrapped in the radio's <label>. The disclosure and the
// details it reveals sit outside it, because a click anywhere inside a label
// picks the option — which made reading a project's challenges or opening its
// SOW impossible without also bidding on it.
function ReferenceProjectCard({
  groupName,
  option,
  selected,
  onChange,
  disabled,
}: {
  groupName: string;
  option: ReferenceOption;
  selected: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const card = option.card;
  const hasDetails = !!card && (card.challenges.length > 0 || !!card.sowPageId);
  const detailsId = `${groupName}-${option.value}-details`;

  return (
    <div
      className={`rounded-lg border transition-colors ${
        selected
          ? "border-os-accent bg-os-accent/5"
          : "border-border bg-card hover:border-os-accent/40"
      }`}
    >
      <Radio
        name={groupName}
        value={option.value}
        checked={selected}
        onChange={onChange}
        disabled={disabled}
        className="w-full items-start p-5"
        label={
          <div className="min-w-0 flex-1 flex flex-col gap-3">
            <div className="flex gap-3 min-w-0 items-center">
              <ProjectCoverImage
                name={option.label}
                imageUrl={card?.imageUrl}
                className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                placeholderClassName="w-16 h-16 rounded-lg flex-shrink-0"
              />
              <div className="min-w-0 flex flex-col gap-1.5">
                <span className="font-heading text-base font-bold text-foreground leading-snug">
                  {option.label}
                </span>
                {card && card.partners.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {card.partners.map((p) => (
                      <span
                        key={p}
                        className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Full card width, below the header row rather than squeezed
                beside the thumbnail — unclamped, since picking a project to
                work on for a term is a real decision worth the vertical space. */}
            {card?.description && (
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                {card.description}
              </p>
            )}
          </div>
        }
      />

      {hasDetails && card && (
        // Indented to line up with the summary text: p-5 + the 4-unit radio + gap-2.
        <div className="px-5 pb-5 pl-11">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((x) => !x)}
            className="inline-flex items-center gap-1 text-xs font-medium text-os-accent hover:text-os-accent/80"
          >
            <ChevronDown
              className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            {expanded ? "Hide details" : "View details"}
          </button>

          {expanded && (
            <div
              id={detailsId}
              className="mt-2 pt-2 border-t border-border/60 flex flex-col gap-1.5"
            >
              {card.challenges.length > 0 && (
                <dl className="flex flex-col gap-3">
                  {card.challenges.map((c) => (
                    <div key={c.domain} className="text-sm">
                      <dt className="inline font-medium text-foreground">
                        {c.domain}:{" "}
                      </dt>
                      {/* Challenge text is authored as multi-line plain text. */}
                      <dd className="inline whitespace-pre-line text-muted-foreground">
                        {c.scope}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {card.sowPageId && (
                // Not a real <a>: inside the desktop app's single webview a
                // target="_blank" click has no window to open into and silently
                // does nothing, so this navigates in place.
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = `/documents/${card.sowPageId}`;
                  }}
                  className="self-start inline-flex items-center gap-1.5 mt-0.5 text-xs font-medium px-2.5 py-1 rounded-full border border-os-accent/40 text-os-accent hover:bg-os-accent/10"
                >
                  <ExternalLink className="w-3 h-3" />
                  Statement of Work
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Card picker for `projects:*` reference options. Same contract as the
// <select> it replaces — one value, stored as the project id.
function ReferenceCardField({
  groupName,
  groupLabel,
  options,
  value,
  onChange,
  disabled = false,
}: {
  groupName: string;
  groupLabel: string;
  options: ReferenceOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={groupLabel}
      className={`flex flex-col gap-2 ${disabled ? "opacity-60" : ""}`}
    >
      {options.map((o) => (
        <ReferenceProjectCard
          key={o.value}
          groupName={groupName}
          option={o}
          selected={value === o.value}
          onChange={() => onChange(o.value)}
          disabled={disabled}
        />
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
            <span className="text-sm text-foreground truncate">{skill}</span>
            <Select
              value={current}
              onChange={(v) => setRating(skill, v)}
              disabled={disabled}
              ariaLabel={skill}
              options={[
                ...(showUnrated ? [{ value: SKILLS_RATING_UNRATED, label: SKILLS_RATING_UNRATED }] : []),
                ...["0", "1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n })),
              ]}
              buttonClassName={`w-14 shrink-0 rounded-md border border-border bg-card text-base sm:text-sm text-center text-foreground py-1 inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40 ${disabled ? "cursor-not-allowed" : ""}`}
            />
          </div>
        );
      })}
    </div>
  );
}

function fileButtonLabel(count: number, max: number, exact: boolean): string {
  if (max === 1) return "Choose file to upload";
  if (exact) {
    const left = max - count;
    if (count === 0) return `Choose ${max} files`;
    return left === 1 ? "Add 1 more file" : `Add ${left} more files`;
  }
  return count === 0 ? `Choose up to ${max} files` : "Add another file";
}

function FileUploadField({
  value,
  onChange,
  accept,
  questionKey,
  maxFiles,
  exact = false,
  uploadUrl,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  accept?: string;
  questionKey: string;
  maxFiles: number;
  exact?: boolean;
  uploadUrl?: string;
  disabled?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keys = parseFileAnswer(value);
  const room = maxFiles - keys.length;

  async function handleFiles(files: File[]) {
    setError(null);
    if (files.length > room) {
      setError(
        maxFiles === 1
          ? "Choose one file"
          : exact
            ? `This question takes exactly ${maxFiles} files`
            : `You can add up to ${maxFiles} files`,
      );
      return;
    }
    setUploading(true);
    const added: string[] = [];
    try {
      for (const file of files) {
        const meta = await uploadFileToS3(file, formUploadKeyPrefix(questionKey), accept, uploadUrl);
        added.push(meta.s3Key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (added.length > 0) onChange(serializeFileAnswer([...keys, ...added], maxFiles));
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) handleFiles(files);
  }

  function remove(key: string) {
    if (disabled) return;
    onChange(serializeFileAnswer(keys.filter((k) => k !== key), maxFiles));
  }

  return (
    <div className={`flex flex-col gap-2 ${disabled ? "opacity-60" : ""}`}>
      {keys.map((key) => (
        <div key={key} className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card">
          <Paperclip className="w-4 h-4 text-os-accent shrink-0" aria-hidden />
          <span className="text-sm text-foreground truncate flex-1">{fileAnswerName(key)}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => remove(key)}
            className={`text-xs text-muted-foreground transition ${disabled ? "cursor-not-allowed" : "hover:text-destructive"}`}
          >
            Remove
          </button>
        </div>
      ))}
      {uploading ? (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-card text-sm text-muted-foreground">
          <span className="inline-block w-4 h-4 border-2 border-border border-t-os-accent rounded-full animate-spin" />
          Uploading...
        </div>
      ) : room > 0 ? (
        <button
          type="button"
          disabled={disabled}
          aria-disabled={disabled || undefined}
          onClick={() => { if (!disabled) fileRef.current?.click(); }}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border bg-card text-sm text-muted-foreground transition w-full ${disabled ? "cursor-not-allowed" : "hover:border-os-accent hover:text-os-accent"}`}
        >
          <Upload className="w-5 h-5" aria-hidden />
          {fileButtonLabel(keys.length, maxFiles, exact)}
        </button>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        onChange={handleInputChange}
        disabled={disabled}
        className="hidden"
        data-testid={`file-input-${questionKey}`}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export interface FormQuestionFieldProps {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  urlCheckState?: UrlCheckState;
  onUrlBlur?: () => void;
  // Presign endpoint for file questions; defaults to the signed-in one.
  uploadUrl?: string;
  disabled?: boolean;
}

export function FormQuestionField({
  question,
  value,
  onChange,
  urlCheckState,
  onUrlBlur,
  uploadUrl,
  disabled = false,
}: FormQuestionFieldProps) {
  const inputBase = INPUT_BASE;
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
      <ChoiceDropdown
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder="Select..."
        options={(question.data.options ?? []).map((o) => ({ value: o, label: o }))}
        className={`${inputBase}${disabledClass}`}
      />
    );
  }

  if (question.type === "checkbox") {
    return (
      <CheckboxField
        options={question.data.options ?? []}
        value={value}
        onChange={onChange}
        allowOther={question.data.allowOther}
        disabled={disabled}
      />
    );
  }

  if (question.type === "radio") {
    return (
      <RadioField
        name={question.key}
        options={question.data.options ?? []}
        value={value}
        onChange={onChange}
        allowOther={question.data.allowOther}
        disabled={disabled}
      />
    );
  }

  if (question.type === "scale") {
    return (
      <ScaleField
        value={value}
        onChange={onChange}
        low={question.data.scaleLow}
        high={question.data.scaleHigh}
        label={question.data.label}
        disabled={disabled}
      />
    );
  }

  if (question.type === "date") {
    return (
      <DateField
        mode="date"
        value={value}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={question.data.label}
        buttonClassName={`${inputBase}${disabledClass}`}
      />
    );
  }

  if (question.type === "number" || question.type === "email") {
    const isEmail = question.type === "email";
    return (
      <input
        type="text"
        inputMode={isEmail ? "email" : "decimal"}
        autoComplete={isEmail ? "email" : "off"}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        className={`${inputBase}${disabledClass}`}
        placeholder={isEmail ? "name@example.com" : "Your answer"}
      />
    );
  }

  if (question.type === "reference") {
    // Options were resolved server-side from the question's data source.
    // The visible label differs from the stored value (a DB id).
    const opts = question.data.referenceOptions ?? [];
    // `projects:*` sources attach a card to every option — render those as
    // selectable cards so a member picking a project sees the partner,
    // blurb, challenges, and SOW rather than just a name. Sources without
    // cards (the domains ones) keep the plain <select>.
    if (opts.length > 0 && opts.every((o) => o.card)) {
      return (
        <ReferenceCardField
          groupName={question.key}
          groupLabel={question.data.label}
          options={opts}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    return (
      <ChoiceDropdown
        value={value}
        onChange={onChange}
        disabled={disabled || opts.length === 0}
        placeholder={opts.length === 0 ? "Nothing to pick here, you can skip this" : "Select..."}
        options={opts.map((o) => ({ value: o.value, label: o.label }))}
        className={`${inputBase}${disabledClass}`}
      />
    );
  }

  if (question.type === "file") {
    return (
      <FileUploadField
        value={value}
        onChange={onChange}
        accept={question.data.accept}
        questionKey={question.key}
        maxFiles={maxFilesFor(question)}
        exact={!!question.data.exactFiles}
        uploadUrl={uploadUrl}
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
