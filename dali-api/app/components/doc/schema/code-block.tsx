import { createCodeBlockSpec } from "@blocknote/core";
import { createRoot } from "react-dom/client";
import { Select, type SelectOption } from "~/components/ui/floating";
import { codeBlockOptions } from "./code-highlighter";

export const LANGUAGE_OPTIONS: SelectOption[] = Object.entries(codeBlockOptions.supportedLanguages).map(
  ([value, { name }]) => ({ value, label: name }),
);

const TRIGGER_CLASS =
  "rounded-md px-1.5 py-0.5 text-xs text-inherit opacity-60 transition-opacity hover:opacity-100 disabled:hover:opacity-60";

const baseSpec = createCodeBlockSpec(codeBlockOptions);
type Render = typeof baseSpec.implementation.render;

const render = function (this: ThisParameterType<Render>, block, editor) {
  const out = baseSpec.implementation.render.call(this, block, editor);
  const native = out.dom.querySelector("select");
  if (this.renderType !== "nodeView" || !native) return out;

  const host = document.createElement("div");
  host.className = "absolute left-3 top-2 z-[1]";
  native.replaceWith(host);
  const root = createRoot(host);
  root.render(
    <Select
      value={native.value}
      options={LANGUAGE_OPTIONS}
      disabled={!editor.isEditable}
      ariaLabel="Code language"
      buttonClassName={TRIGGER_CLASS}
      insideEditor
      onChange={(language) => editor.updateBlock(block.id, { props: { language } })}
    />,
  );
  const inPicker = (node: EventTarget | Node | null) => node instanceof Node && host.contains(node);
  return {
    ...out,
    ignoreMutation: (m: MutationRecord | { type: "selection"; target: Node }) => inPicker(m.target),
    stopEvent: (e: Event) => inPicker(e.target),
    destroy: () => {
      out.destroy?.();
      queueMicrotask(() => root.unmount());
    },
  };
} as Render;

export const codeBlockSpec = {
  ...baseSpec,
  implementation: { ...baseSpec.implementation, render },
};
