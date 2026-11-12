// @vitest-environment jsdom
import { createRef } from "react";
import { act } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderDom } from "~/test-utils/render";
import { AnchoredCard } from "./AnchoredCard";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const rect = { left: 100, right: 200, top: 100, bottom: 130, width: 100, height: 30, x: 100, y: 100, toJSON() {} } as DOMRect;

function mousedown(target: Element, init: MouseEventInit = {}) {
  act(() => {
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true, button: 0, ...init }));
  });
}

function card() {
  return document.querySelector<HTMLElement>("[role='dialog']")!;
}

describe("AnchoredCard", () => {
  it("is a named dialog", () => {
    renderDom(<AnchoredCard anchor={rect} onClose={() => {}} ariaLabel="New event">body</AnchoredCard>);
    expect(card().getAttribute("aria-label")).toBe("New event");
    expect(card().textContent).toContain("body");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    renderDom(<AnchoredCard anchor={rect} onClose={onClose}>body</AnchoredCard>);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on an outside mousedown but not an inside one", () => {
    const onClose = vi.fn();
    renderDom(<AnchoredCard anchor={rect} onClose={onClose}><button type="button">inner</button></AnchoredCard>);
    mousedown(card().querySelector("button")!);
    expect(onClose).not.toHaveBeenCalled();
    mousedown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close on a mousedown inside a floating-layer portal", () => {
    const onClose = vi.fn();
    renderDom(<AnchoredCard anchor={rect} onClose={onClose}>body</AnchoredCard>);
    const layer = document.createElement("div");
    layer.setAttribute("data-floating-ui-portal", "");
    const option = document.createElement("button");
    layer.appendChild(option);
    document.body.appendChild(layer);
    mousedown(option);
    expect(onClose).not.toHaveBeenCalled();
    layer.remove();
  });

  it("does not close on a mousedown on excludeRef", () => {
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const excludeRef = createRef<HTMLElement>() as { current: HTMLElement | null };
    excludeRef.current = trigger;
    renderDom(<AnchoredCard anchor={rect} onClose={onClose} excludeRef={excludeRef}>body</AnchoredCard>);
    mousedown(trigger);
    expect(onClose).not.toHaveBeenCalled();
    trigger.remove();
  });

  it("drags by the handle but not from a button inside it", () => {
    renderDom(
      <AnchoredCard anchor={rect} onClose={() => {}} draggable>
        <div data-drag-handle>
          <span data-testid="grip">grip</span>
          <button type="button">x</button>
        </div>
      </AnchoredCard>,
    );
    mousedown(card().querySelector("button")!);
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 250 }));
    });
    expect(card().style.left).not.toBe("300px");

    mousedown(card().querySelector("[data-testid='grip']")!, { clientX: 10, clientY: 10 });
    act(() => {
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: 300, clientY: 250 }));
      window.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(card().style.left).toBe("290px");
    expect(card().style.top).toBe("240px");
  });

  it("is centered near the top with no anchor", () => {
    renderDom(<AnchoredCard anchor={null} onClose={() => {}}>body</AnchoredCard>);
    expect(card().style.left).toBe("50%");
    expect(card().style.top).toBe("72px");
  });
});
