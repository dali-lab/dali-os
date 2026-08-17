// Shared, dependency-free definitions for the document-signing field + variable
// nodes. Imported by BOTH the client editor specs (app/components/doc/schema/
// signing.tsx) and the server export renderers (app/collab/export-*.ts) so the
// node type names and value formatting never drift between authoring, fill,
// and export. No editor / React / Prisma imports here — keep it pure. In
// particular this module must stay importable from the browser editor chunk,
// so it must NOT import ~/collab/legacy/pm-to-blocknote (node:crypto): callers
// that need PM→block conversion (sign.server, loaders) run ensureBlocks
// themselves before handing bodies to the walkers below.
//
// The walkers accept BOTH body formats:
//   - BlockNote block JSON (array) — the storage format for new/edited
//     SigningDocumentVersion bodies and new frozen signature snapshots.
//   - Legacy ProseMirror JSON ({type:"doc"}) — pre-migration rows; supported
//     read-only so frozen archives and not-yet-normalized inputs still walk.

export const SIGNING_FIELD_TYPES = [
  "signatureField",
  "dateField",
  "initialField",
  "checkboxField",
  "textField",
  // Pre-signed staff counter-signature: bound to a configured signatory at
  // authoring time; renders their name and is never filled by the member.
  "adminSignatureField",
] as const;
export type SigningFieldType = (typeof SIGNING_FIELD_TYPES)[number];

// The role/roleKey the pre-signed admin signature is recorded under — the
// fixed staff counter-signature slot, kept out of the member-fill flow.
export const ADMIN_SIGNATURE_ROLE = "supervisor";

// Every node type this feature adds to the document schema (fields + the
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
  adminSignatureField: "admin-signature-field",
};

// Human labels for the authoring pill + the insert-field controls.
export const FIELD_LABEL: Record<SigningFieldType, string> = {
  signatureField: "Signature",
  dateField: "Date",
  initialField: "Initial",
  checkboxField: "Checkbox",
  textField: "Text",
  adminSignatureField: "Admin signature",
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

// ---------------------------------------------------------------------------
// Structural shapes. Deliberately loose (like blocksToPlainText in
// ~/components/doc/schema/configs) so any Block[] — JSON column, editor
// document, conversion output — walks fine without schema generics.

type PMNodeLike = {
  type?: string;
  attrs?: Record<string, unknown> | null;
  content?: PMNodeLike[];
  [k: string]: unknown;
};

type InlineLike = {
  type?: string;
  text?: string;
  props?: Record<string, unknown>;
  content?: InlineLike[] | string;
  [k: string]: unknown;
};

type TableCellLike = InlineLike[] | { content?: InlineLike[]; [k: string]: unknown };

type BlockLike = {
  type?: string;
  props?: Record<string, unknown>;
  content?: InlineLike[] | { rows?: { cells?: TableCellLike[] }[] } | string;
  children?: BlockLike[];
  [k: string]: unknown;
};

function isTableContent(
  content: BlockLike["content"],
): content is { rows?: { cells?: TableCellLike[] }[] } {
  return (
    content != null &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    Array.isArray((content as { rows?: unknown }).rows)
  );
}

function cellInlines(cell: TableCellLike): InlineLike[] {
  if (Array.isArray(cell)) return cell;
  return Array.isArray(cell.content) ? cell.content : [];
}

// ---------------------------------------------------------------------------
// Bake

// Block props are string-typed (signingFieldPropSchema.value default "");
// captured checkbox values arrive as booleans, so they stringify to
// "true"/"false" — isCheckboxChecked and fieldDisplayText accept both forms.
function toPropValue(value: unknown): string {
  return value == null ? "" : String(value);
}

export interface BakeSigningOpts {
  fieldValues?: Record<string, unknown>;
  variables?: Record<string, string>;
}

/**
 * Produce an archival copy of a document body with captured field values and
 * resolved variable values baked into each signing node's `value` prop, so the
 * renderers (which read props/attrs only) reproduce the completed document
 * without the live values map. Pure + immutable — never mutates the input.
 *
 * Accepts block JSON (array → bakes into `props.value`, the storage format for
 * NEW frozen snapshots) or legacy ProseMirror JSON ({type:"doc"} → bakes into
 * `attrs.value`, preserved for legacy-format callers/tests). Signature-time
 * callers normalize the version body through ensureBlocks first so every new
 * frozen body is block JSON.
 */
export function bakeSigningBody(body: unknown, opts: BakeSigningOpts = {}): unknown {
  const fieldValues = opts.fieldValues ?? {};
  const variables = opts.variables ?? {};

  if (Array.isArray(body)) {
    const bakeInline = (inline: InlineLike): InlineLike => {
      const type = inline.type ?? "";
      if (isSigningFieldType(type)) {
        const fid = inline.props?.fieldId;
        if (typeof fid === "string" && fid in fieldValues) {
          return {
            ...inline,
            props: { ...(inline.props ?? {}), value: toPropValue(fieldValues[fid]) },
          };
        }
        return inline;
      }
      if (type === "variable") {
        const name = inline.props?.name;
        if (typeof name === "string" && name in variables) {
          return { ...inline, props: { ...(inline.props ?? {}), value: variables[name] } };
        }
        return inline;
      }
      // e.g. link inline content — recurse so fields inside never get missed.
      if (Array.isArray(inline.content)) {
        return { ...inline, content: inline.content.map(bakeInline) };
      }
      return inline;
    };

    const bakeBlock = (block: BlockLike): BlockLike => {
      const next: BlockLike = { ...block };
      if (Array.isArray(block.content)) {
        next.content = block.content.map(bakeInline);
      } else if (isTableContent(block.content)) {
        next.content = {
          ...block.content,
          rows: (block.content.rows ?? []).map((row) => ({
            ...row,
            cells: (row.cells ?? []).map((cell) =>
              Array.isArray(cell)
                ? cell.map(bakeInline)
                : { ...cell, content: cellInlines(cell).map(bakeInline) },
            ),
          })),
        };
      }
      if (Array.isArray(block.children)) {
        next.children = block.children.map(bakeBlock);
      }
      return next;
    };

    return (body as BlockLike[]).map(bakeBlock);
  }

  // Legacy ProseMirror walk (attrs-based). Kept byte-compatible with the
  // pre-migration behavior: raw values (booleans included) land in attrs.value.
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

// ---------------------------------------------------------------------------
// Collect

export interface SigningFieldRef {
  fieldId: string;
  type: SigningFieldType;
  role: string;
  required: boolean;
}

/**
 * Walk a document body and collect every placeable field's descriptor. Used to
 * validate that a signer filled all their required fields, and to seed
 * auto-filled (date) values. Accepts block JSON (array) or legacy ProseMirror
 * JSON ({type:"doc"}); `required` defaults to true when absent, matching the
 * legacy authoring semantics on both formats.
 */
export function collectSigningFields(body: unknown): SigningFieldRef[] {
  const out: SigningFieldRef[] = [];

  const pushField = (type: SigningFieldType, bag: Record<string, unknown> | null | undefined) => {
    const fieldId = bag?.fieldId;
    if (typeof fieldId !== "string") return;
    out.push({
      fieldId,
      type,
      role: typeof bag?.role === "string" ? bag.role : "",
      required: bag?.required !== false,
    });
  };

  if (Array.isArray(body)) {
    const visitInline = (inline: InlineLike) => {
      const type = inline.type ?? "";
      if (isSigningFieldType(type)) pushField(type, inline.props);
      if (Array.isArray(inline.content)) inline.content.forEach(visitInline);
    };
    const visitBlock = (block: BlockLike) => {
      if (Array.isArray(block.content)) {
        block.content.forEach(visitInline);
      } else if (isTableContent(block.content)) {
        for (const row of block.content.rows ?? []) {
          for (const cell of row.cells ?? []) cellInlines(cell).forEach(visitInline);
        }
      }
      (block.children ?? []).forEach(visitBlock);
    };
    (body as BlockLike[]).forEach(visitBlock);
    return out;
  }

  const walk = (node: PMNodeLike) => {
    const type = node.type ?? "";
    if (isSigningFieldType(type)) pushField(type, node.attrs);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  if (body && typeof body === "object") walk(body as PMNodeLike);
  return out;
}

// ---------------------------------------------------------------------------
// Admin signatories

export interface AdminSignatory {
  /** The configured signatory's user id (empty string if unset in the builder). */
  userId: string;
  /** Their display name, baked into the field at authoring time. */
  name: string;
}

/**
 * Collect the pre-signed admin-signature fields placed in a document body,
 * de-duplicated by userId. Issuance turns each into a supervisor counter-
 * signature audit record. Accepts block JSON (array) or legacy ProseMirror JSON.
 */
export function collectAdminSignatories(body: unknown): AdminSignatory[] {
  const byUser = new Map<string, string>();

  const push = (bag: Record<string, unknown> | null | undefined) => {
    const userId = bag?.signerUserId;
    if (typeof userId !== "string" || userId === "") return;
    const name = typeof bag?.value === "string" ? bag.value : "";
    if (!byUser.has(userId)) byUser.set(userId, name);
  };

  if (Array.isArray(body)) {
    const visitInline = (inline: InlineLike) => {
      if (inline.type === "adminSignatureField") push(inline.props);
      if (Array.isArray(inline.content)) inline.content.forEach(visitInline);
    };
    const visitBlock = (block: BlockLike) => {
      if (Array.isArray(block.content)) {
        block.content.forEach(visitInline);
      } else if (isTableContent(block.content)) {
        for (const row of block.content.rows ?? []) {
          for (const cell of row.cells ?? []) cellInlines(cell).forEach(visitInline);
        }
      }
      (block.children ?? []).forEach(visitBlock);
    };
    (body as BlockLike[]).forEach(visitBlock);
  } else if (body && typeof body === "object") {
    const walk = (node: PMNodeLike) => {
      if (node.type === "adminSignatureField") push(node.attrs);
      if (Array.isArray(node.content)) node.content.forEach(walk);
    };
    walk(body as PMNodeLike);
  }

  return [...byUser].map(([userId, name]) => ({ userId, name }));
}

// ---------------------------------------------------------------------------
// Emptiness

/**
 * True when a version body has no text content — the save/sign gates key off
 * it. Ports the legacy isEmptyDoc semantics (text runs only; atoms like fields
 * and images don't count) to both formats so the gate behavior is unchanged.
 */
export function isEmptyBody(body: unknown): boolean {
  const hasText = (node: unknown): boolean => {
    if (!node || typeof node !== "object") return false;
    if (Array.isArray(node)) return node.some(hasText);
    const n = node as {
      text?: unknown;
      content?: unknown;
      children?: unknown;
      rows?: unknown;
      cells?: unknown;
    };
    if (typeof n.text === "string" && n.text.length > 0) return true;
    return hasText(n.content) || hasText(n.children) || hasText(n.rows) || hasText(n.cells);
  };
  if (Array.isArray(body)) return !hasText(body);
  if (!body || typeof body !== "object") return true;
  if ((body as { type?: unknown }).type !== "doc") return true;
  return !hasText((body as PMNodeLike).content);
}
