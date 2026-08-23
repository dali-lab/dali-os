import { useRef, useState } from "react";
import { Form as RRForm } from "react-router";
import { ArrowDown } from "lucide-react";
import { DocEditor } from "~/components/doc";
import { isCheckboxChecked, type SigningFieldRef } from "~/lib/signing-fields";

interface SigningFillViewProps {
  /** BlockNote block JSON — the loader normalizes legacy bodies on read. */
  body: unknown;
  variables: Record<string, string>;
  // The member-role fields, used to seed date values and validate required ones.
  fields: SigningFieldRef[];
  next: string | null;
  // Server-side rejection from the sign action (e.g. the required-field
  // re-check), surfaced in the rail so a failed submit isn't silent.
  error?: string | null;
}

// Renders the agreement read-only except the current member's fields, which are
// interactive (fill mode keeps them live under editable=false). Captured values
// live in host React state keyed by fieldId — never in the document — and are
// posted as JSON; the submit button unlocks once every required member field is
// filled (the hard gate, re-checked server-side by recordSignature).
export function SigningFillView({ body, variables, fields, next, error }: SigningFillViewProps) {
  const memberFields = fields.filter((f) => f.role === "member");
  const articleRef = useRef<HTMLElement>(null);

  // Seed date fields with the resolved sign date so they're captured too.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of memberFields) {
      if (f.type === "dateField") seed[f.fieldId] = variables.today ?? "";
    }
    return seed;
  });

  const isFilled = (f: SigningFieldRef): boolean => {
    const v = values[f.fieldId];
    return f.type === "checkboxField"
      ? isCheckboxChecked(v)
      : v != null && String(v).trim() !== "";
  };

  // Required member fields drive the progress counter, the "where do I sign"
  // jump, and the submit gate. memberFields is in document order, so the first
  // unfilled one is the natural "next".
  const requiredFields = memberFields.filter((f) => f.required);
  const filledCount = requiredFields.filter(isFilled).length;
  const totalRequired = requiredFields.length;
  const nextEmpty = requiredFields.find((f) => !isFilled(f));
  const allRequiredFilled = !nextEmpty;

  // Scroll the next unfilled required field into view and focus its input, so a
  // signer never has to hunt for the fields buried in a long agreement.
  const jumpToNext = () => {
    if (!nextEmpty || !articleRef.current) return;
    const el = articleRef.current.querySelector<HTMLElement>(
      `[data-field-id="${CSS.escape(nextEmpty.fieldId)}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.querySelector<HTMLElement>("input")?.focus();
  };

  const pct = totalRequired ? Math.round((filledCount / totalRequired) * 100) : 0;
  const remaining = totalRequired - filledCount;

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      {/* DocuSign-style follow-along rail: sticks to the viewport as the signer
          scrolls the agreement, tracks progress, and jumps to the next field. */}
      <aside className="md:sticky md:top-6 md:w-56 md:shrink-0">
        <div className="space-y-4 rounded-lg border border-border bg-card p-4">
          {totalRequired > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-muted-foreground">Your progress</span>
                <span className={allRequiredFilled ? "text-green-600" : "text-foreground"}>
                  {filledCount}/{totalRequired}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ${allRequiredFilled ? "bg-green-600" : "bg-accent-coral"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className={`text-xs ${allRequiredFilled ? "font-medium text-green-600" : "text-muted-foreground"}`}>
                {allRequiredFilled
                  ? "All required fields complete."
                  : `${remaining} required field${remaining === 1 ? "" : "s"} left`}
              </p>
            </div>
          )}

          {!allRequiredFilled && (
            <button
              type="button"
              onClick={jumpToNext}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent-coral px-3 py-2 text-xs font-medium text-white hover:bg-accent-coral/90"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              {filledCount === 0 ? "Start signing" : "Next field"}
            </button>
          )}

          <RRForm method="post" className="space-y-2">
            <input type="hidden" name="intent" value="sign" />
            {next && <input type="hidden" name="next" value={next} />}
            <input type="hidden" name="fieldValues" value={JSON.stringify(values)} />
            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </p>
            )}
            <button
              type="submit"
              // Stays enabled while incomplete so the click isn't a dead end —
              // it jumps to the first missing field instead of submitting.
              onClick={(e) => {
                if (!allRequiredFilled) {
                  e.preventDefault();
                  jumpToNext();
                }
              }}
              className={`w-full rounded-md px-4 py-2 text-sm font-medium ${
                allRequiredFilled
                  ? "bg-accent-coral text-white hover:bg-accent-coral/90"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted/50"
              }`}
            >
              I agree and sign
            </button>
            {!allRequiredFilled && (
              <p className="text-center text-xs text-muted-foreground">
                Complete all required fields to sign.
              </p>
            )}
          </RRForm>
        </div>
      </aside>

      <article ref={articleRef} className="min-w-0 flex-1 rounded-lg border border-border bg-card p-6">
        <DocEditor
          features="agreement"
          editable={false}
          initialContent={body}
          signing={{
            mode: "fill",
            signerRole: "member",
            variables,
            values,
            onFieldChange: (fieldId, value) =>
              setValues((prev) => ({ ...prev, [fieldId]: value })),
          }}
        />
      </article>
    </div>
  );
}
