// Authoring-side insert helpers for the signing surface. Runtime-light: the
// editor types come in as `import type`, so importing these helpers doesn't
// pull BlockNote into the caller's chunk (the caller already has a live editor
// instance to pass in).

import { ADMIN_SIGNATURE_ROLE, type SigningFieldType } from "~/lib/signing-fields";
import type { DocEditorInstance } from "./schema/build";

export interface InsertSigningFieldOpts {
  type: SigningFieldType;
  /** Signer role this field belongs to (fill mode matches on it). */
  role: string;
  label?: string;
  required?: boolean; // default true, matching legacy authoring semantics
  placeholder?: string;
}

/**
 * Insert a placeable signing field at the caret (plus a trailing space).
 * Generates and returns the fieldId — hosts key captured values on it.
 */
export function insertSigningField(
  editor: DocEditorInstance,
  opts: InsertSigningFieldOpts,
): string {
  const fieldId = crypto.randomUUID();
  editor.insertInlineContent([
    {
      type: opts.type,
      props: {
        fieldId,
        role: opts.role,
        label: opts.label ?? "",
        placeholder: opts.placeholder ?? "",
        value: "", // baked value — only set in frozen snapshots
        required: opts.required ?? true,
        signerUserId: "", // only the pre-signed adminSignatureField uses this
      },
    },
    " ",
  ]);
  return fieldId;
}

/** Insert a merge variable ({{name}}) at the caret. */
export function insertVariable(editor: DocEditorInstance, name: string): void {
  editor.insertInlineContent([{ type: "variable", props: { name, value: "" } }, " "]);
}

/**
 * Insert a pre-signed admin-signature field bound to a configured signatory.
 * The signatory's name is baked into `value` so it renders immediately (author
 * preview, member's read-only copy, exports); `signerUserId` drives the
 * supervisor audit signature created at issuance. Returns the fieldId.
 */
export function insertAdminSignature(
  editor: DocEditorInstance,
  signatory: { userId: string; name: string },
): string {
  const fieldId = crypto.randomUUID();
  editor.insertInlineContent([
    {
      type: "adminSignatureField",
      props: {
        fieldId,
        role: ADMIN_SIGNATURE_ROLE,
        label: "",
        placeholder: "",
        value: signatory.name,
        required: false,
        signerUserId: signatory.userId,
      },
    },
    " ",
  ]);
  return fieldId;
}
