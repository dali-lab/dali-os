// Shared, dependency-free definitions for the document-signing field + variable
// nodes. Imported by BOTH the client editor nodes (app/components/editor/
// signing-fields.tsx) and the server export renderers (app/collab/export-*.ts)
// so the node type names and value formatting never drift between authoring,
// fill, and export. No Tiptap / React / Prisma imports here — keep it pure.

export const SIGNING_FIELD_TYPES = [
  "signatureField",
  "dateField",
  "initialField",
  "checkboxField",
  "textField",
] as const;
export type SigningFieldType = (typeof SIGNING_FIELD_TYPES)[number];

// Every node type this feature adds to the ProseMirror schema (fields + the
// merge-variable node).
export const SIGNING_NODE_TYPES = [...SIGNING_FIELD_TYPES, "variable"] as const;

export function isSigningFieldType(type: string): type is SigningFieldType {
  return (SIGNING_FIELD_TYPES as readonly string[]).includes(type);
}

// data-type attribute used for HTML round-tripping in parseHTML/renderHTML.
export const FIELD_DATA_TYPE: Record<SigningFieldType, string> = {
  signatureField: "signature-field",
  dateField: "date-field",
  initialField: "initial-field",
  checkboxField: "checkbox-field",
  textField: "text-field",
};

// Human labels for the authoring pill + the insert-field toolbar.
export const FIELD_LABEL: Record<SigningFieldType, string> = {
  signatureField: "Signature",
  dateField: "Date",
  initialField: "Initial",
  checkboxField: "Checkbox",
  textField: "Text",
};

export const CHECKBOX_CHECKED = "☑"; // ☑
export const CHECKBOX_UNCHECKED = "☐"; // ☐

export function isCheckboxChecked(value: unknown): boolean {
  return value === true || value === "true";
}

// Plain-text rendering of a captured field value, shared by the read-only
// nodeView and both export renderers.
export function fieldDisplayText(type: SigningFieldType, value: unknown): string {
  if (type === "checkboxField") {
    return isCheckboxChecked(value) ? CHECKBOX_CHECKED : CHECKBOX_UNCHECKED;
  }
  return value == null ? "" : String(value);
}

// A merge variable resolves to its value; unresolved it shows its own token so
// an un-filled template still reads sensibly.
export function variableDisplayText(name: string, value: unknown): string {
  return value == null || value === "" ? `{{${name}}}` : String(value);
}

type PMNodeLike = {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: PMNodeLike[];
  [k: string]: unknown;
};

// Produce an archival copy of a document body with captured field values and
// resolved variable values baked into each node's `value` attr, so the export
// renderers (which read attrs) reproduce the completed document without needing
// the live values map. Pure + immutable — never mutates the input.
export function bakeSigningBody(
  body: unknown,
  opts: { fieldValues?: Record<string, unknown>; variables?: Record<string, string> } = {},
): unknown {
  const fieldValues = opts.fieldValues ?? {};
  const variables = opts.variables ?? {};

  const walk = (node: PMNodeLike): PMNodeLike => {
    const next: PMNodeLike = { ...node };
    const type = node.type ?? "";
    if (isSigningFieldType(type)) {
      const fid = node.attrs?.fieldId;
      if (typeof fid === "string" && fid in fieldValues) {
        next.attrs = { ...(node.attrs ?? {}), value: fieldValues[fid] };
      }
    } else if (type === "variable") {
      const name = node.attrs?.name;
      if (typeof name === "string" && name in variables) {
        next.attrs = { ...(node.attrs ?? {}), value: variables[name] };
      }
    }
    if (Array.isArray(node.content)) {
      next.content = node.content.map(walk);
    }
    return next;
  };

  if (!body || typeof body !== "object") return body;
  return walk(body as PMNodeLike);
}

export interface SigningFieldRef {
  fieldId: string;
  type: SigningFieldType;
  role: string;
  required: boolean;
}

// Walk a document body and collect every placeable field's descriptor. Used to
// validate that a signer filled all their required fields, and to seed
// auto-filled (date) values.
export function collectSigningFields(body: unknown): SigningFieldRef[] {
  const out: SigningFieldRef[] = [];
  const walk = (node: PMNodeLike) => {
    const type = node.type ?? "";
    if (isSigningFieldType(type)) {
      const fieldId = node.attrs?.fieldId;
      if (typeof fieldId === "string") {
        out.push({
          fieldId,
          type,
          role: typeof node.attrs?.role === "string" ? node.attrs.role : "",
          required: node.attrs?.required !== false,
        });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  if (body && typeof body === "object") walk(body as PMNodeLike);
  return out;
}
