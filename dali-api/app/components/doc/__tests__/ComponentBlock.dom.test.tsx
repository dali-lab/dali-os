// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { ComponentBlock } from "../schema/component";
import { markFreshComponent } from "../schema/fresh-components";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const onRemove = vi.fn();

function mount(blockId: string, data: object, editable = true) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(ComponentBlock, { blockId, kind: "spacer", data: JSON.stringify(data), editable, onSave, onRemove }),
      ),
    ),
  );
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  onSave.mockReset();
  onRemove.mockReset();
});

const click = (el: Element) => act(() => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const inEditor = () => container.querySelector("form") !== null;
const data = { fields: { height: "48" }, items: [] };

describe("ComponentBlock", () => {
  it("opens the editor for the member who just inserted it, and Cancel removes the block", () => {
    markFreshComponent("b1");
    mount("b1", data);
    expect(inEditor()).toBe(true);
    click(button("Cancel"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("opens the editor when the insert is registered after the block renders", () => {
    mount("b2", data);
    expect(inEditor()).toBe(false);
    act(() => markFreshComponent("b2"));
    expect(inEditor()).toBe(true);
  });

  it("keeps a saved new block when it is edited and cancelled later", () => {
    markFreshComponent("b3");
    mount("b3", data);
    act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(inEditor()).toBe(false);
    click(container.querySelector(".dali-cmp-edit")!);
    click(button("Cancel"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(inEditor()).toBe(false);
  });

  it("does not open the editor for another client when the data carries a legacy _new flag", () => {
    mount("b4", { fields: { height: "48", _new: "1" }, items: [] });
    expect(inEditor()).toBe(false);
  });

  it("strips a legacy _new flag when saving", () => {
    mount("b5", { fields: { height: "48", _new: "1" }, items: [] });
    click(container.querySelector(".dali-cmp-edit")!);
    act(() => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(onSave.mock.calls[0]![0].fields).not.toHaveProperty("_new");
  });

  it("never removes a block that was not just inserted", () => {
    mount("b6", data);
    click(container.querySelector(".dali-cmp-edit")!);
    click(button("Cancel"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(inEditor()).toBe(false);
  });

  it("does not open for a read-only viewer", () => {
    markFreshComponent("b7");
    mount("b7", data, false);
    expect(inEditor()).toBe(false);
  });
});
