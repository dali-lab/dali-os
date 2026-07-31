import { useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Form as RRForm } from "react-router";
import StarterKit from "@tiptap/starter-kit";
import { EDITOR_VIEWER_CONTENT_CLASS, linkExtension } from "~/components/editor/shared";
import { imageExtension } from "~/components/editor/image";
import { signingFieldExtensions } from "~/components/editor/signing-fields";
import { isCheckboxChecked, type SigningFieldRef } from "~/lib/signing-fields";

interface SigningFillViewProps {
  body: unknown;
  variables: Record<string, string>;
  // The member-role fields, used to seed date values and validate required ones.
  fields: SigningFieldRef[];
  next: string | null;
}

// Renders the agreement read-only except the current member's fields, which are
// interactive. Values are collected in a ref (uncontrolled inputs) and posted as
// JSON; the submit button unlocks once every required member field is filled.
export function SigningFillView({ body, variables, fields, next }: SigningFillViewProps) {
  const memberFields = fields.filter((f) => f.role === "member");

  // Seed date fields with the resolved sign date so they're captured too.
  const initial = useMemo(() => {
    const seed: Record<string, unknown> = {};
    for (const f of memberFields) {
      if (f.type === "dateField") seed[f.fieldId] = variables.today ?? "";
    }
    return seed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const valuesRef = useRef<Record<string, unknown>>({ ...initial });
  const [tick, setTick] = useState(0);

  const ctx = useMemo(
    () => ({
      mode: "fill" as const,
      signerRole: "member",
      variables,
      values: valuesRef.current,
      onFieldChange: (fieldId: string, value: unknown) => {
        valuesRef.current[fieldId] = value;
        setTick((t) => t + 1);
      },
    }),
    [variables],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      StarterKit,
      linkExtension({ interactive: true }),
      imageExtension(),
      ...signingFieldExtensions(ctx),
    ],
    content: (body as object) ?? "",
    editorProps: { attributes: { class: EDITOR_VIEWER_CONTENT_CLASS } },
  });

  void tick; // re-render on value change so the button enable-state tracks input

  const allRequiredFilled = memberFields
    .filter((f) => f.required)
    .every((f) => {
      const v = valuesRef.current[f.fieldId];
      return f.type === "checkboxField"
        ? isCheckboxChecked(v)
        : v != null && String(v).trim() !== "";
    });

  return (
    <div className="space-y-6">
      <article className="bg-card border border-border rounded-lg p-6">
        <EditorContent editor={editor} />
      </article>

      <RRForm method="post" className="flex items-center justify-end gap-3">
        <input type="hidden" name="intent" value="sign" />
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="fieldValues" value={JSON.stringify(valuesRef.current)} />
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
