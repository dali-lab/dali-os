// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DialogProvider, useDialog, useConfirmSubmit } from "./dialog";

// Tell React we drive updates through act() (no setupFile in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Minimal render harness (no @testing-library in this repo — mirrors the
// createRoot/act pattern used by useOptimisticBoardMove.test.tsx). The dialog
// renders inline (not via a portal) inside the provider, so it lands in the
// same container we can query.
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

function clickButton(container: HTMLElement, label: string) {
  const btn = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`button "${label}" not found`);
  act(() => {
    btn.click();
  });
}

// Set a controlled input's value the way React expects (native setter + input event).
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const flush = () => act(async () => {});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("useDialog().confirm", () => {
  it("resolves true when the confirm button is clicked", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let result: boolean | undefined;
    await act(async () => {
      api
        .confirm({ title: "Delete file?", confirmLabel: "Delete" })
        .then((r) => {
          result = r;
        });
    });

    expect(container.textContent).toContain("Delete file?");
    clickButton(container, "Delete");
    await flush();

    expect(result).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull(); // closed
    cleanup();
  });

  it("resolves false when the cancel button is clicked", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let result: boolean | undefined;
    await act(async () => {
      api.confirm({ title: "Delete file?", tone: "destructive" }).then((r) => {
        result = r;
      });
    });

    clickButton(container, "Cancel");
    await flush();

    expect(result).toBe(false);
    cleanup();
  });
});

describe("useDialog().prompt", () => {
  it("resolves the typed value on submit", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let result: string | null | undefined;
    await act(async () => {
      api.prompt({ title: "New folder", label: "Folder name" }).then((r) => {
        result = r;
      });
    });

    const input = container.querySelector("input")!;
    typeInto(input, "Designs");
    clickButton(container, "Save");
    await flush();

    expect(result).toBe("Designs");
    cleanup();
  });

  it("resolves null when cancelled", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let result: string | null | undefined = "unset";
    await act(async () => {
      api.prompt({ title: "New folder" }).then((r) => {
        result = r;
      });
    });

    clickButton(container, "Cancel");
    await flush();

    expect(result).toBeNull();
    cleanup();
  });

  it("blocks submission and shows the error when validate fails", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let resolved = false;
    await act(async () => {
      api
        .prompt({
          title: "Add link",
          validate: (v) => (v.startsWith("http") ? null : "Bad URL"),
        })
        .then(() => {
          resolved = true;
        });
    });

    const input = container.querySelector("input")!;
    typeInto(input, "nope");
    clickButton(container, "Save");
    await flush();

    expect(resolved).toBe(false); // still open
    expect(container.textContent).toContain("Bad URL");
    cleanup();
  });
});

describe("useConfirmSubmit", () => {
  it("opens the dialog and only submits the form after confirming", async () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    function TestForm() {
      const confirmSubmit = useConfirmSubmit();
      return createElement(
        "form",
        { onSubmit: confirmSubmit({ title: "Delete group?", tone: "destructive" }) },
        createElement("button", { type: "submit" }, "Delete group"),
      );
    }

    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(TestForm)),
    );

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    // First pass: blocked, dialog shown, no real submission yet.
    expect(container.textContent).toContain("Delete group?");
    expect(requestSubmit).not.toHaveBeenCalled();

    clickButton(container, "Confirm");
    await flush();

    // After confirm: the form is re-submitted for real exactly once.
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not submit when the confirm is cancelled", async () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    function TestForm() {
      const confirmSubmit = useConfirmSubmit();
      return createElement(
        "form",
        { onSubmit: confirmSubmit({ title: "Delete group?" }) },
        createElement("button", { type: "submit" }, "Go"),
      );
    }

    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(TestForm)),
    );

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    clickButton(container, "Cancel");
    await flush();

    expect(requestSubmit).not.toHaveBeenCalled();
    cleanup();
  });
});
