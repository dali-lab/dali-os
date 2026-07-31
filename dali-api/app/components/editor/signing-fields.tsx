// Placeable signing fields + merge variables for the document-signing editor.
// Custom inline atom nodes following the Callout pattern in blocks.ts: plain-DOM
// nodeViews (no React renderer) whose interactivity is driven by a per-surface
// `ctx` passed via .configure(). One shared bundle — signingFieldExtensions(ctx)
// — is registered on EVERY surface that reads a signing body (author, fill,
// viewer, export-prep), or ProseMirror silently strips the nodes on load, the
// same discipline documented for images in RichTextViewer.
//
// These docs are non-collaborative (authored once, filled individually), so the
// "all Yjs clients must share the schema" constraint from blocks.ts relaxes to
// "every surface must register these extensions."

import { Node as TiptapNode, mergeAttributes } from "@tiptap/core";
import {
  SIGNING_FIELD_TYPES,
  FIELD_DATA_TYPE,
  FIELD_LABEL,
  type SigningFieldType,
  fieldDisplayText,
  isCheckboxChecked,
} from "~/lib/signing-fields";

export type SigningFieldMode = "author" | "fill" | "view";

export interface SigningFieldCtx {
  mode: SigningFieldMode;
  // fill: the role whose fields are interactive for this signer.
  signerRole?: string;
  // fieldId -> captured value. Seeds uncontrolled inputs in fill mode and is the
  // read source in view / other-role rendering.
  values?: Record<string, unknown>;
  // variable name -> resolved value (e.g. term "26S", today's date).
  variables?: Record<string, string>;
  // fill: report a value change up to the host (kept in React state there).
  onFieldChange?: (fieldId: string, value: unknown) => void;
}

const DEFAULT_CTX: SigningFieldCtx = { mode: "view" };

// A string data-* attribute with parseHTML/renderHTML round-tripping, matching
// the Callout attr style. Empty/null attrs are omitted from the rendered HTML.
function dataAttr(name: string, dataName: string) {
  return {
    default: null as unknown,
    parseHTML: (el: HTMLElement) => el.getAttribute(dataName),
    renderHTML: (attrs: Record<string, unknown>) => {
      const v = attrs[name];
      return v == null || v === "" ? {} : { [dataName]: String(v) };
    },
  };
}

function authorPillText(
  type: SigningFieldType,
  role: string,
  label: string,
  required: boolean,
): string {
  const who = role ? `: ${role}` : "";
  const req = required ? "*" : "";
  const name = label || FIELD_LABEL[type];
  return `⟦${name}${who}${req}⟧`;
}

function makeFieldNode(type: SigningFieldType) {
  const dataType = FIELD_DATA_TYPE[type];
  return TiptapNode.create<{ ctx: SigningFieldCtx }>({
    name: type,
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return { ctx: DEFAULT_CTX };
    },

    addAttributes() {
      return {
        fieldId: dataAttr("fieldId", "data-field-id"),
        role: dataAttr("role", "data-role"),
        label: dataAttr("label", "data-label"),
        placeholder: dataAttr("placeholder", "data-placeholder"),
        value: dataAttr("value", "data-value"),
        required: {
          default: true,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-required") !== "false",
          renderHTML: (attrs: Record<string, unknown>) => ({
            "data-required": attrs.required === false ? "false" : "true",
          }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `span[data-type='${dataType}']` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-type": dataType })];
    },

    addNodeView() {
      const ctx = this.options.ctx;
      return ({ node }) => ({ dom: renderFieldDom(type, node.attrs, ctx) });
    },
  });
}

function renderFieldDom(
  type: SigningFieldType,
  attrs: Record<string, unknown>,
  ctx: SigningFieldCtx,
): HTMLElement {
  const fieldId = String(attrs.fieldId ?? "");
  const role = String(attrs.role ?? "");
  const label = String(attrs.label ?? "");
  const required = attrs.required !== false;
  const seeded = ctx.values?.[fieldId];
  const baked = attrs.value;

  const dom = document.createElement("span");
  dom.setAttribute("contenteditable", "false");

  // Authoring: a static pill describing the field. Configuration (role/label/
  // required) is edited from the authoring side panel via updateAttributes.
  if (ctx.mode === "author") {
    dom.className = "signing-field signing-field--author";
    dom.textContent = authorPillText(type, role, label, required);
    return dom;
  }

  const isOwn = ctx.mode === "fill" && !!role && role === ctx.signerRole;

  if (isOwn) {
    dom.className = "signing-field signing-field--input";
    if (type === "checkboxField") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = isCheckboxChecked(seeded ?? baked);
      input.addEventListener("change", () => ctx.onFieldChange?.(fieldId, input.checked));
      dom.appendChild(input);
      if (label) {
        const l = document.createElement("span");
        l.className = "signing-field__label";
        l.textContent = ` ${label}`;
        dom.appendChild(l);
      }
    } else if (type === "dateField") {
      // Auto-filled, read-only: shows the resolved sign date.
      const span = document.createElement("span");
      span.className = "signing-field__value";
      const v = seeded ?? baked ?? ctx.variables?.today ?? "";
      span.textContent = v ? String(v) : "";
      dom.appendChild(span);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "signing-field__text";
      input.value = seeded != null ? String(seeded) : "";
      input.placeholder =
        String(attrs.placeholder ?? "") ||
        (type === "signatureField"
          ? "Type your full name to sign"
          : type === "initialField"
            ? "Initials"
            : label || "");
      input.addEventListener("input", () => ctx.onFieldChange?.(fieldId, input.value));
      dom.appendChild(input);
    }
    return dom;
  }

  // view mode, or another role's field in fill mode: read-only value or a blank
  // signature line.
  dom.className = "signing-field signing-field--readonly";
  const text = fieldDisplayText(type, seeded ?? baked);
  if (type === "checkboxField") {
    dom.textContent = text;
  } else if (text) {
    dom.classList.add("signing-field__value");
    dom.textContent = text;
  } else {
    const line = document.createElement("span");
    line.className = "signing-field__line";
    line.textContent = "          ";
    dom.appendChild(line);
  }
  return dom;
}

function makeVariableNode() {
  return TiptapNode.create<{ ctx: SigningFieldCtx }>({
    name: "variable",
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,

    addOptions() {
      return { ctx: DEFAULT_CTX };
    },

    addAttributes() {
      return {
        name: dataAttr("name", "data-name"),
        value: dataAttr("value", "data-value"),
      };
    },

    parseHTML() {
      return [{ tag: "span[data-type='variable']" }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["span", mergeAttributes(HTMLAttributes, { "data-type": "variable" })];
    },

    addNodeView() {
      const ctx = this.options.ctx;
      return ({ node }) => {
        const name = String(node.attrs.name ?? "");
        const resolved = ctx.variables?.[name];
        const baked = node.attrs.value;
        const dom = document.createElement("span");
        dom.setAttribute("contenteditable", "false");
        if (ctx.mode === "author") {
          dom.className = "signing-variable signing-variable--token";
          dom.textContent = `{{${name}}}`;
        } else {
          dom.className = "signing-variable";
          dom.textContent =
            resolved != null && resolved !== ""
              ? String(resolved)
              : baked != null && baked !== ""
                ? String(baked)
                : `{{${name}}}`;
        }
        return { dom };
      };
    },
  });
}

// The shared bundle. Register on every surface that reads a signing body.
export function signingFieldExtensions(ctx: SigningFieldCtx) {
  return [
    ...SIGNING_FIELD_TYPES.map((t) => makeFieldNode(t).configure({ ctx })),
    makeVariableNode().configure({ ctx }),
  ];
}
