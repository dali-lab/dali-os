// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider, useToast } from "./toast";

// Tell React we drive updates through act() (no setupFile in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function captureToast() {
  let api!: ReturnType<typeof useToast>;
  function Capture() {
    api = useToast();
    return null;
  }
  const mounted = mount(
    createElement(ToastProvider, null, createElement(Capture)),
  );
  return { ...mounted, get api() {
    return api;
  } };
}

describe("useToast", () => {
  it("renders an error toast with role=alert and the message", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.error("Failed to mark unavailable.");
    });
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(container.textContent).toContain("Failed to mark unavailable.");
    cleanup();
  });

  it("renders success/info toasts with role=status", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.success("Saved.");
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.textContent).toContain("Saved.");
    cleanup();
  });

  it("removes a toast when its dismiss button is clicked", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Heads up");
    });
    expect(container.textContent).toContain("Heads up");

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss"]',
    )!;
    act(() => {
      dismiss.click();
    });
    expect(container.textContent).not.toContain("Heads up");
    cleanup();
  });

  it("auto-dismisses after the given duration", () => {
    vi.useFakeTimers();
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Transient", { duration: 1000 });
    });
    expect(container.textContent).toContain("Transient");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.textContent).not.toContain("Transient");
    cleanup();
  });

  it("keeps a toast with duration 0 until dismissed", () => {
    vi.useFakeTimers();
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.error("Sticky", { duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("Sticky");
    cleanup();
  });
});
