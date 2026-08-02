// Signing field family + merge variable as React inline-content specs over the
// shared configs. Mode semantics are a 1:1 port of the legacy plain-DOM node
// views (app/components/editor/signing-fields.tsx) and reuse its app.css
// classes (.signing-field*, .signing-variable*) and the pure helpers in
// ~/lib/signing-fields, so authoring/fill/view/export never drift.
//
// Interactivity is driven by SigningContext (React context, not .configure()):
// the spike proved context propagation reaches BlockNote's inline node views —
// including across editable-invariant transitions like fill<->view — and that
// TipTap's stopEvent (BlockNote's underlying engine) lets inputs/checkboxes inside inline content stay live
// under editable:false. Fill values live in HOST state via ctx.onFieldChange.

import { createReactInlineContentSpec } from "@blocknote/react";
import { useContext } from "react";
import {
  FIELD_LABEL,
  fieldDisplayText,
  isCheckboxChecked,
  variableDisplayText,
  type SigningFieldType,
} from "~/lib/signing-fields";
import { SigningContext } from "../signing-context";
import {
  SIGNING_FIELD_TYPES,
  signingFieldPropSchema,
  variableConfig,
} from "./configs";

interface FieldProps {
  fieldId: string;
  role: string;
  label: string;
  placeholder: string;
  value: string; // baked value (frozen snapshots); "" = unset
  required: boolean;
}

function SigningFieldRenderer({ type, ...props }: FieldProps & { type: SigningFieldType }) {
  const ctx = useContext(SigningContext);
  const { fieldId, role, label, required } = props;
  const seeded = ctx.values?.[fieldId];
  const baked = props.value === "" ? undefined : props.value;

  if (ctx.mode === "author") {
    const who = role ? `: ${role}` : "";
    return (
      <span className="signing-field signing-field--author" data-field-id={fieldId}>
        ⟦{label || FIELD_LABEL[type]}
        {who}
        {required ? "*" : ""}⟧
      </span>
    );
  }

  const isOwn = ctx.mode === "fill" && !!role && role === ctx.signerRole;

  if (isOwn) {
    if (type === "checkboxField") {
      return (
        <span className="signing-field signing-field--input" data-field-id={fieldId}>
          <input
            type="checkbox"
            checked={isCheckboxChecked(seeded ?? baked)}
            onChange={(e) => ctx.onFieldChange?.(fieldId, e.target.checked)}
          />
          {label ? <span className="signing-field__label"> {label}</span> : null}
        </span>
      );
    }
    if (type === "dateField") {
      // Auto-filled, read-only: shows the resolved sign date.
      const v = seeded ?? baked ?? ctx.variables?.today ?? "";
      return (
        <span className="signing-field signing-field--input" data-field-id={fieldId}>
          <span className="signing-field__value">{v ? String(v) : ""}</span>
        </span>
      );
    }
    return (
      <span className="signing-field signing-field--input" data-field-id={fieldId}>
        <input
          type="text"
          className="signing-field__text"
          value={seeded != null ? String(seeded) : ""}
          placeholder={
            props.placeholder ||
            (type === "signatureField"
              ? "Type your full name to sign"
              : type === "initialField"
                ? "Initials"
                : label || "")
          }
          onChange={(e) => ctx.onFieldChange?.(fieldId, e.target.value)}
        />
      </span>
    );
  }

  // view mode, or another role's field in fill mode: read-only value or a
  // blank signature line.
  const text = fieldDisplayText(type, seeded ?? baked);
  if (type === "checkboxField") {
    return (
      <span className="signing-field signing-field--readonly" data-field-id={fieldId}>
        {text}
      </span>
    );
  }
  if (text) {
    return (
      <span
        className="signing-field signing-field--readonly signing-field__value"
        data-field-id={fieldId}
      >
        {text}
      </span>
    );
  }
  return (
    <span className="signing-field signing-field--readonly" data-field-id={fieldId}>
      <span className="signing-field__line">{" ".repeat(10)}</span>
    </span>
  );
}

// One spec per field type, all sharing the contract's propSchema OBJECT (not a
// copy) so client and server schemas stay identical.
function createFieldSpec<T extends SigningFieldType>(type: T) {
  return createReactInlineContentSpec(
    { type, propSchema: signingFieldPropSchema, content: "none" } as const,
    {
      render: ({ inlineContent }) => (
        <SigningFieldRenderer type={type} {...inlineContent.props} />
      ),
    },
  );
}

function VariableRenderer({ name, value }: { name: string; value: string }) {
  const ctx = useContext(SigningContext);
  if (ctx.mode === "author") {
    return <span className="signing-variable signing-variable--token">{`{{${name}}}`}</span>;
  }
  const resolved = ctx.variables?.[name];
  const effective = resolved != null && resolved !== "" ? resolved : value;
  return <span className="signing-variable">{variableDisplayText(name, effective)}</span>;
}

export const VariableSpec = createReactInlineContentSpec(variableConfig, {
  render: ({ inlineContent }) => (
    <VariableRenderer name={inlineContent.props.name} value={inlineContent.props.value} />
  ),
});

/** The full signing spec bundle keyed by node type — spread into a schema's
 * inlineContentSpecs. Registered on EVERY surface that reads a signing body,
 * or the nodes are silently stripped on load (same discipline as legacy). */
export const signingInlineSpecs = {
  signatureField: createFieldSpec("signatureField"),
  dateField: createFieldSpec("dateField"),
  initialField: createFieldSpec("initialField"),
  checkboxField: createFieldSpec("checkboxField"),
  textField: createFieldSpec("textField"),
  variable: VariableSpec,
} as const;

// Sanity: the bundle must cover exactly the contract's field list.
const _covered: readonly SigningFieldType[] = SIGNING_FIELD_TYPES;
void _covered;
