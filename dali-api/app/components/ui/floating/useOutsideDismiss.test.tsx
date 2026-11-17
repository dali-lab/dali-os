// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderDom } from "~/test-utils/render";
import { act } from "react";
import { useOutsideDismiss } from "./useOutsideDismiss";

function Probe({ active = true, escape = false, onDismiss }: { active?: boolean; escape?: boolean; onDismiss: () => void }) {
  useOutsideDismiss(active, ".inside", onDismiss, { escape });
  return createElement("div", { className: "inside" }, createElement("span", { id: "child" }));
}
const down = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));

describe("useOutsideDismiss", () => {
  it("dismisses on a click outside, not inside", () => {
    const onDismiss = vi.fn();
    renderDom(createElement(Probe, { onDismiss }));
    down(document.getElementById("child")!);
    expect(onDismiss).not.toHaveBeenCalled();
    down(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("treats a click in a floating layer as inside", () => {
    const onDismiss = vi.fn();
    renderDom(createElement(Probe, { onDismiss }));
    const portal = document.createElement("div");
    portal.setAttribute("data-floating-ui-portal", "");
    document.body.appendChild(portal);
    down(portal);
    expect(onDismiss).not.toHaveBeenCalled();
    portal.remove();
  });

  it("does nothing while inactive", () => {
    const onDismiss = vi.fn();
    renderDom(createElement(Probe, { active: false, escape: true, onDismiss }));
    down(document.body);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("dismisses on Escape only when asked", () => {
    const off = vi.fn();
    renderDom(createElement(Probe, { onDismiss: off }));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(off).not.toHaveBeenCalled();
    const on = vi.fn();
    renderDom(createElement(Probe, { escape: true, onDismiss: on }));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(on).toHaveBeenCalledTimes(1);
  });
});
