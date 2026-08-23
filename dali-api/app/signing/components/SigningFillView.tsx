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
  // The floating follow-along shows while there are required fields still to
  // fill; it hides once done so it never covers the sign button at the bottom.
  const showFollowAlong = totalRequired > 0 && !allRequiredFilled;

  return (
    <div className={`space-y-6 ${showFollowAlong ? "pb-24" : ""}`}>
      <article ref={articleRef} className="bg-card border border-border rounded-lg p-6">
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

      <RRForm method="post" className="flex flex-col items-end gap-2">
        <input type="hidden" name="intent" value="sign" />
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="fieldValues" value={JSON.stringify(values)} />
        {error && (
          <p
            role="alert"
            className="w-full rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        {!allRequiredFilled && (
          <span className="text-sm text-muted-foreground">
            Complete all required fields to sign.
          </span>
        )}
        <button
          type="submit"
          // Stays enabled while incomplete so the click isn't a dead end — it
          // jumps to the first missing field instead of submitting.
          onClick={(e) => {
            if (!allRequiredFilled) {
              e.preventDefault();
              jumpToNext();
            }
          }}
          className={`rounded-md px-4 py-2 text-sm font-medium ${
            allRequiredFilled
              ? "bg-accent-coral text-white hover:bg-accent-coral/90"
              : "border border-border bg-card text-muted-foreground hover:bg-muted/50"
          }`}
        >
          I agree and sign
        </button>
      </RRForm>

      {/* Floating follow-along — position:fixed so it tracks the viewport as the
          signer scrolls (DocuSign-style). Fixed survives the tab-shell iframe
          where a sticky rail did not. The full-width row is click-through
          (pointer-events-none) except the pill itself, so it never blocks the
          document beneath it. */}
      {showFollowAlong && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent-coral transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                {filledCount}/{totalRequired}
              </span>
            </div>
            <button
              type="button"
              onClick={jumpToNext}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-coral/90"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              {filledCount === 0 ? "Start signing" : "Next field"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
