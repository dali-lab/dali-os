import { useState } from "react";
import { Form as RRForm } from "react-router";
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

  // Seed date fields with the resolved sign date so they're captured too.
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = {};
    for (const f of memberFields) {
      if (f.type === "dateField") seed[f.fieldId] = variables.today ?? "";
    }
    return seed;
  });

  const allRequiredFilled = memberFields
    .filter((f) => f.required)
    .every((f) => {
      const v = values[f.fieldId];
      return f.type === "checkboxField"
        ? isCheckboxChecked(v)
        : v != null && String(v).trim() !== "";
    });

  return (
    <div className="space-y-6">
      <article className="bg-card border border-border rounded-lg p-6">
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
