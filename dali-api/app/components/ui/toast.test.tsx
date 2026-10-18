// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { OS_SURFACE_CLASS } from "./floating/styles";
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

  it("marks success in the os status green, not brand teal", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.success("Saved.");
    });
    const html = container.innerHTML;
    expect(html).toContain("text-os-green");
    expect(html).not.toContain("accent-teal");
    cleanup();
  });

  it("wears the floating-layer surface and not cal-surface, whose border:none overrode it", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Heads up.");
    });
    const frame = container.querySelector('[role="status"]')!;
    expect(frame.className).not.toContain("cal-surface");
    for (const cls of OS_SURFACE_CLASS.split(" ")) expect(frame.classList.contains(cls)).toBe(true);
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

  it("renders each action as a button, runs it on click and dismisses the toast", () => {
    const { container, api, cleanup } = captureToast();
    const open = vi.fn();
    const undo = vi.fn();
    act(() => {
      api.success("Filed to Core", {
        actions: [
          { label: "Open", onClick: open },
          { label: "Undo", onClick: undo },
        ],
      });
    });
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(["Open", "Undo"]));

    const undoButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
    act(() => {
      undoButton.click();
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Filed to Core");
    cleanup();
  });

  it("replaces a toast pushed with the same id instead of stacking a second", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Uploading 1 of 3", { id: "up", duration: 0 });
    });
    act(() => {
      api.info("Uploading 2 of 3", { id: "up", duration: 0 });
    });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).toContain("Uploading 2 of 3");
    expect(container.textContent).not.toContain("Uploading 1 of 3");
    cleanup();
  });

  it("stacks toasts that have different ids", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("One", { id: "a" });
      api.info("Two", { id: "b" });
    });
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(2);
    cleanup();
  });

  it("lets a replacement change variant and start auto-dismissing", () => {
    vi.useFakeTimers();
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Working", { id: "up", duration: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(container.textContent).toContain("Working");
    act(() => {
      api.error("Done with errors", { id: "up", duration: 1000 });
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain("Done with errors");
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(container.textContent).toContain("Done with errors");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.textContent).not.toContain("Done with errors");
    cleanup();
  });

  it("renders no action row when none are given", () => {
    const { container, api, cleanup } = captureToast();
    act(() => {
      api.info("Plain");
    });
    expect([...container.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Dismiss",
    ]);
    cleanup();
  });

  function timer(container: HTMLElement) {
    return container.querySelector<HTMLElement>("[data-toast-timer]");
  }
  function card(container: HTMLElement) {
    return container.querySelector<HTMLElement>('[role="status"],[role="alert"]')!;
  }
  const hover = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  const unhover = (el: HTMLElement) =>
    act(() => {
      el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });

  describe("time bar", () => {
    it("draws a bar that runs for the toast's duration", () => {
      const { container, api, cleanup } = captureToast();
      act(() => {
        api.info("Timed", { duration: 1000 });
      });
      const bar = timer(container)!;
      expect(bar).not.toBeNull();
      expect(bar.getAttribute("aria-hidden")).toBe("true");
      expect(bar.style.animationDuration).toBe("1000ms");
      expect(bar.style.animationPlayState).toBe("running");
      cleanup();
    });

    it("draws no bar on a toast that never auto-dismisses", () => {
      const { container, api, cleanup } = captureToast();
      act(() => {
        api.error("Sticky", { duration: 0 });
      });
      expect(timer(container)).toBeNull();
      expect(card(container).hasAttribute("data-paused")).toBe(false);
      cleanup();
    });

    it("pauses the timer and the bar while hovered, then waits only for the remaining time", () => {
      vi.useFakeTimers();
      const { container, api, cleanup } = captureToast();
      act(() => {
        api.info("Hover me", { duration: 1000 });
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      hover(card(container));
      expect(timer(container)!.style.animationPlayState).toBe("paused");
      expect(card(container).hasAttribute("data-paused")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(container.textContent).toContain("Hover me");

      unhover(card(container));
      expect(timer(container)!.style.animationPlayState).toBe("running");
      act(() => {
        vi.advanceTimersByTime(399);
      });
      expect(container.textContent).toContain("Hover me");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(container.textContent).not.toContain("Hover me");
      cleanup();
    });

    it("pauses while a button inside has focus and resumes when focus leaves", () => {
      vi.useFakeTimers();
      const { container, api, cleanup } = captureToast();
      act(() => {
        api.success("Focus me", {
          duration: 1000,
          actions: [
            { label: "Open", onClick: () => {} },
            { label: "Undo", onClick: () => {} },
          ],
        });
      });
      const buttons = [...container.querySelectorAll("button")];
      act(() => {
        buttons[0].focus();
      });
      expect(card(container).hasAttribute("data-paused")).toBe(true);
      act(() => {
        buttons[1].focus();
      });
      expect(card(container).hasAttribute("data-paused")).toBe(true);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(container.textContent).toContain("Focus me");

      act(() => {
        buttons[1].blur();
      });
      expect(card(container).hasAttribute("data-paused")).toBe(false);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.textContent).not.toContain("Focus me");
      cleanup();
    });

    it("pauses while the tab is hidden", () => {
      vi.useFakeTimers();
      const { container, api, cleanup } = captureToast();
      act(() => {
        api.info("Away", { duration: 1000 });
      });
      const original = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
      let state = "hidden";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      try {
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        expect(card(container).hasAttribute("data-paused")).toBe(true);
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(container.textContent).toContain("Away");

        state = "visible";
        act(() => {
          document.dispatchEvent(new Event("visibilitychange"));
        });
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(container.textContent).not.toContain("Away");
      } finally {
        delete (document as { visibilityState?: unknown }).visibilityState;
        if (original) Object.defineProperty(Document.prototype, "visibilityState", original);
      }
      cleanup();
    });

    it("still dismisses on an action click while paused", () => {
      vi.useFakeTimers();
      const { container, api, cleanup } = captureToast();
      const undo = vi.fn();
      act(() => {
        api.info("Paused action", { duration: 1000, actions: [{ label: "Undo", onClick: undo }] });
      });
      hover(card(container));
      const undoButton = [...container.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;
      act(() => {
        undoButton.click();
      });
      expect(undo).toHaveBeenCalledTimes(1);
      expect(container.textContent).not.toContain("Paused action");
      cleanup();
    });
  });
});
