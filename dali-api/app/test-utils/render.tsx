import { afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mounted = { root: Root; container: HTMLElement; mounted: boolean };
const live = new Set<Mounted>();

export function renderDom(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry: Mounted = { root, container, mounted: true };
  live.add(entry);
  act(() => root.render(ui));
  return {
    container,
    root,
    rerender(next: ReactNode) {
      act(() => root.render(next));
    },
    unmount() {
      if (!entry.mounted) return;
      entry.mounted = false;
      act(() => root.unmount());
      container.remove();
      live.delete(entry);
    },
  };
}

export function click(el: Element) {
  act(() => {
    (el as HTMLElement).click();
  });
}

export function getButton(container: ParentNode, label: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  if (!btn) throw new Error(`button "${label}" not found`);
  return btn;
}

export function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  for (const entry of [...live]) {
    if (entry.mounted) act(() => entry.root.unmount());
    entry.container.remove();
  }
  live.clear();
  document.body.innerHTML = "";
});
