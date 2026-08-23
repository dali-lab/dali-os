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
}

// Renders the agreement read-only except the current member's fields, which are
// interactive (fill mode keeps them live under editable=false). Captured values
// live in host React state keyed by fieldId — never in the document — and are
// posted as JSON; the submit button unlocks once every required member field is
// filled (the hard gate, re-checked server-side by recordSignature).
export function SigningFillView({ body, variables, fields, next }: SigningFillViewProps) {
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

  return (
    <div className="space-y-6">
      {totalRequired > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm">
          <span className={allRequiredFilled ? "font-medium text-green-600" : "text-muted-foreground"}>
            {allRequiredFilled
              ? "All required fields complete."
              : `${filledCount} of ${totalRequired} required field${totalRequired === 1 ? "" : "s"} complete`}
          </span>
          {!allRequiredFilled && (
            <button
              type="button"
              onClick={jumpToNext}
              className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-coral/90"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              {filledCount === 0 ? "Start signing" : "Next field"}
            </button>
          )}
        </div>
      )}
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

      <RRForm method="post" className="flex items-center justify-end gap-3">
        <input type="hidden" name="intent" value="sign" />
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="fieldValues" value={JSON.stringify(values)} />
        {!allRequiredFilled && (
          <span className="text-sm text-muted-foreground">
            Complete all required fields to sign.
          </span>
        )}
        <button
          type="submit"
          disabled={!allRequiredFilled}
          className="px-4 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90 disabled:opacity-50"
        >
          I agree and sign
        </button>
      </RRForm>
    </div>
  );
}
