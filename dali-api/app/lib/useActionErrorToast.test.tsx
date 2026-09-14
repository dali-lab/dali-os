// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "~/components/ui/toast";
import { useActionErrorToast } from "./useActionErrorToast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Data = { error?: unknown } | undefined | null;

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  return {
    container,
    render: (next: ReactNode) => act(() => root.render(next)),
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function Harness({ data, fallback }: { data: Data; fallback?: string }) {
  useActionErrorToast(data, fallback ? { fallback } : undefined);
  return null;
}

function tree(data: Data, fallback?: string) {
  return createElement(
    ToastProvider,
    null,
    createElement(Harness, { data, fallback }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("useActionErrorToast", () => {
  it("shows no toast when there is no error", () => {
    const { container, cleanup } = mount(tree(null));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    cleanup();
  });

  it("surfaces a string error as an alert toast", () => {
    const { container, cleanup } = mount(tree({ error: "Not eligible." }));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Not eligible.");
    cleanup();
  });

  it("uses the fallback for a non-string / empty error", () => {
    const { container, cleanup } = mount(tree({ error: true }, "Try again."));
    expect(container.textContent).toContain("Try again.");
    cleanup();
  });

  it("does not re-fire on re-render with the same result object", () => {
    const data = { error: "Boom" };
    const { container, render, cleanup } = mount(tree(data));
    expect(container.querySelectorAll('[role="alert"]').length).toBe(1);
    render(tree(data)); // same object identity → no new toast
    expect(container.querySelectorAll('[role="alert"]').length).toBe(1);
    cleanup();
  });

  it("re-fires for a new result object even with the same message", () => {
    const { container, render, cleanup } = mount(tree({ error: "Boom" }));
    expect(container.querySelectorAll('[role="alert"]').length).toBe(1);
    render(tree({ error: "Boom" })); // fresh object → retry should toast again
    expect(container.querySelectorAll('[role="alert"]').length).toBe(2);
    cleanup();
  });
});
