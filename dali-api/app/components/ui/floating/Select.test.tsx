// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select, type SelectOption } from "./Select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
function mount(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(ui));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const opts: SelectOption<string>[] = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
];

describe("Select", () => {
  // ProseMirror treats an attribute change on a block as a document change and
  // rebuilds the block, unmounting any Select that lives in it.
  it("touches nothing outside the panel when insideEditor is set", async () => {
    const sibling = document.createElement("div");
    document.body.appendChild(sibling);
    mount(createElement(Select, { value: "a", options: opts, onChange: () => {}, ariaLabel: "Fruit", insideEditor: true }));
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.body.querySelector("[role='listbox']")).toBeTruthy();
    expect(sibling.hasAttribute("data-floating-ui-inert")).toBe(false);
    sibling.remove();
  });

  it("renders a hidden native <select name> carrying the value for <Form> submission", () => {
    mount(createElement(Select, { name: "fruit", defaultValue: "b", options: opts, ariaLabel: "Fruit" }));
    const hidden = container.querySelector("select[name='fruit']") as HTMLSelectElement | null;
    expect(hidden).toBeTruthy();
    expect(hidden!.value).toBe("b");
  });

  it("omits the hidden native select when no name is given (pure controlled)", () => {
    mount(createElement(Select, { value: "a", options: opts, onChange: () => {}, ariaLabel: "Fruit" }));
    expect(container.querySelector("select")).toBeNull();
  });

  it("shows the selected option's label on the trigger", () => {
    mount(createElement(Select, { value: "a", options: opts, onChange: () => {}, ariaLabel: "Fruit" }));
    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger?.textContent).toContain("Apple");
  });

  it("shows the placeholder when nothing is selected", () => {
    mount(createElement(Select, { name: "fruit", options: opts, placeholder: "Pick one", ariaLabel: "Fruit" }));
    const trigger = container.querySelector("button[aria-haspopup='listbox']");
    expect(trigger?.textContent).toContain("Pick one");
  });
});
