import type { Question } from "~/types";
import {
  FormQuestionField,
  type UrlCheckState,
} from "~/components/form-builder/QuestionField";
import { InfoBody } from "~/components/form-builder/info-body";

// The per-question wrapper that every fill surface used to hand-write:
// label + standardized required star + optional description + the field.
// The field renderer itself stays in FormQuestionField — this only owns
// the chrome around it (and the `info` prose block, which is not a field).

export interface FormFieldProps {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  // Optional wrapper id (e.g. portal.apply's `question-${key}` scroll anchor).
  id?: string;
  urlCheckState?: UrlCheckState;
  onUrlBlur?: () => void;
  // default "font-medium"; sites that want the heavier label pass "font-semibold"
  labelClassName?: string;
  // e.g. ChallengePreview's "Shown after domain questions" pill
  labelSuffix?: React.ReactNode;
  // e.g. portal.apply's url-warning / word-count line
  belowField?: React.ReactNode;
  // Override the field renderer (e.g. MemberFormFillView's "no uploads here" notice).
  renderField?: (q: Question) => React.ReactNode;
}

export function FormField({
  question,
  value,
  onChange,
  disabled = false,
  id,
  urlCheckState,
  onUrlBlur,
  labelClassName = "font-medium",
  labelSuffix,
  belowField,
  renderField,
}: FormFieldProps) {
  if (question.type === "info") {
    return (
      <div
        id={id}
        className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground"
      >
        <InfoBody body={question.data.body} />
      </div>
    );
  }

  return (
    <div id={id}>
      <label className={`block text-sm ${labelClassName} text-dark-blue mb-1`}>
        {question.data.label}
        {question.required && <span className="text-accent-coral ml-0.5">*</span>}
        {labelSuffix}
      </label>
      {question.data.description && (
        <p className="text-xs text-muted-foreground mb-1">{question.data.description}</p>
      )}
      {renderField ? (
        renderField(question)
      ) : (
        <FormQuestionField
          question={question}
          value={value}
          onChange={onChange}
          disabled={disabled}
          urlCheckState={urlCheckState}
          onUrlBlur={onUrlBlur}
        />
      )}
      {belowField}
    </div>
  );
}

export interface FormFieldListProps {
  questions: Question[];
  disabled?: boolean;
  labelClassName?: string;
  values?: Record<string, string>;
  onChange?: (key: string, v: string) => void;
  // Per-question slots, keyed implicitly by the question, for route-specific extras.
  id?: (q: Question) => string | undefined;
  labelSuffix?: (q: Question) => React.ReactNode;
  belowField?: (q: Question) => React.ReactNode;
  renderField?: (q: Question) => React.ReactNode;
  urlCheckState?: (q: Question) => UrlCheckState | undefined;
  onUrlBlur?: (q: Question) => void;
}

export function FormFieldList({
  questions,
  disabled,
  labelClassName,
  values,
  onChange,
  id,
  labelSuffix,
  belowField,
  renderField,
  urlCheckState,
  onUrlBlur,
}: FormFieldListProps) {
  return (
    <>
      {questions.map((q) => (
        <FormField
          key={q.key}
          question={q}
          value={values?.[q.key] ?? ""}
          onChange={(v) => onChange?.(q.key, v)}
          disabled={disabled}
          id={id?.(q)}
          labelClassName={labelClassName}
          labelSuffix={labelSuffix?.(q)}
          belowField={belowField?.(q)}
          renderField={renderField}
          urlCheckState={urlCheckState?.(q)}
          onUrlBlur={onUrlBlur ? () => onUrlBlur(q) : undefined}
        />
      ))}
    </>
  );
}
