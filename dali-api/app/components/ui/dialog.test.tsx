// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DialogProvider, useDialog, useConfirmSubmit } from "./dialog";
import { MODAL_TITLE_CLASS } from "~/components/Modal";

// Tell React we drive updates through act() (no setupFile in this repo).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Minimal render harness (no @testing-library in this repo — mirrors the
// createRoot/act pattern used by useOptimisticBoardMove.test.tsx). The dialog
// portals to document.body, so the harness queries the body.
function mount(ui: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return {
    container: document.body,
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

describe("useDialog().confirm with onConfirm", () => {
  it("holds the dialog open and shows the returned message as an error", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    let settled = false;
    await act(async () => {
      api
        .confirm({
          title: "Delete file?",
          confirmLabel: "Delete",
          tone: "destructive",
          onConfirm: async () => "That file is locked.",
        })
        .then(() => {
          settled = true;
        });
    });

    clickButton(container, "Delete");
    await flush();

    expect(container.textContent).toContain("That file is locked.");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(settled).toBe(false);
    cleanup();
  });

  it("closes and resolves true once onConfirm resolves without a message", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    const work = vi.fn(async () => {});
    let result: boolean | undefined;
    await act(async () => {
      api
        .confirm({ title: "Delete file?", confirmLabel: "Delete", onConfirm: work })
        .then((r) => {
          result = r;
        });
    });

    clickButton(container, "Delete");
    await flush();

    expect(work).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    cleanup();
  });

  it("surfaces a thrown error instead of closing", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    await act(async () => {
      void api.confirm({
        title: "Delete file?",
        confirmLabel: "Delete",
        onConfirm: async () => {
          throw new Error("Network down");
        },
      });
    });

    clickButton(container, "Delete");
    await flush();

    expect(container.textContent).toContain("Network down");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    cleanup();
  });
});

describe("useConfirmSubmit on a multi-submit form", () => {
  it("picks the dialog off the clicked button and keeps it as the submitter", async () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    function TestForm() {
      const confirmSubmit = useConfirmSubmit();
      return createElement(
        "form",
        {
          onSubmit: confirmSubmit((submitter) =>
            submitter?.value === "delete"
              ? { title: "Delete it?", confirmLabel: "Yes, delete", tone: "destructive" }
              : null,
          ),
        },
        createElement("button", { type: "submit", name: "intent", value: "save" }, "Save"),
        createElement("button", { type: "submit", name: "intent", value: "delete" }, "Delete"),
      );
    }

    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(TestForm)),
    );

    const form = container.querySelector("form")!;
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.value === "delete",
    )!;

    // A SubmitEvent carrying the Delete button as its submitter.
    await act(async () => {
      form.dispatchEvent(
        new SubmitEvent("submit", {
          bubbles: true,
          cancelable: true,
          submitter: deleteBtn,
        }),
      );
    });

    expect(container.textContent).toContain("Delete it?");
    clickButton(container, "Yes, delete");
    await flush();

    // Re-submitted WITH the submitter, so the action still receives intent=delete.
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(requestSubmit).toHaveBeenCalledWith(deleteBtn);
    cleanup();
  });

  it("lets a button with no dialog submit straight through", async () => {
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});

    function TestForm() {
      const confirmSubmit = useConfirmSubmit();
      return createElement(
        "form",
        {
          onSubmit: confirmSubmit((submitter) =>
            submitter?.value === "delete" ? { title: "Delete it?" } : null,
          ),
        },
        createElement("button", { type: "submit", name: "intent", value: "save" }, "Save"),
      );
    }

    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(TestForm)),
    );

    const form = container.querySelector("form")!;
    const saveBtn = container.querySelector("button")! as HTMLButtonElement;
    let defaultPrevented = false;
    await act(async () => {
      const ev = new SubmitEvent("submit", {
        bubbles: true,
        cancelable: true,
        submitter: saveBtn,
      });
      form.dispatchEvent(ev);
      defaultPrevented = ev.defaultPrevented;
    });

    // No dialog, nothing blocked — the browser's own submission proceeds.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(defaultPrevented).toBe(false);
    expect(requestSubmit).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("useDialog().prompt", () => {
  it("wears the destructive confirm button when toned destructive", async () => {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const { container, cleanup } = mount(
      createElement(DialogProvider, null, createElement(Capture)),
    );

    await act(async () => {
      void api.prompt({
        title: 'Delete project "dali-os"?',
        label: "Type the name to confirm",
        confirmLabel: "Delete project",
        tone: "destructive",
      });
    });

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Delete project",
    )!;
    expect(confirm.className).toContain("dali-btn--destructive");
    cleanup();
  });
});

describe("useDialog dress matches Modal", () => {
  function setup() {
    let api!: ReturnType<typeof useDialog>;
    function Capture() {
      api = useDialog();
      return null;
    }
    const mounted = mount(createElement(DialogProvider, null, createElement(Capture)));
    return { ...mounted, get api() { return api; } };
  }
  // Button's own utilities still name coral; the shell's .dali-btn rules
  // repaint it, so only the dialog's own elements are checked.
  const ownCoral = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("*")).filter(
      (el) => !el.classList.contains("dali-btn") && (el.getAttribute("class") ?? "").includes("accent-coral"),
    );
  const cancelButton = (c: HTMLElement) =>
    Array.from(c.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Cancel")!;

  it("confirm uses the ModalHeader title and the ModalFooter ghost cancel", async () => {
    const { container, api, cleanup } = setup();
    await act(async () => { void api.confirm({ title: "Archive?" }); });
    expect(container.querySelector("h2")!.className).toBe(MODAL_TITLE_CLASS);
    expect(cancelButton(container).classList.contains("os-btn-ghost")).toBe(true);
    expect(ownCoral(container)).toEqual([]);
    cleanup();
  });

  it("destructive confirm keeps the destructive button and leaves focus on Cancel", async () => {
    const { container, api, cleanup } = setup();
    await act(async () => { void api.confirm({ title: "Delete?", tone: "destructive", confirmLabel: "Delete" }); });
    await flush();
    const del = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Delete")!;
    expect(del.className).toContain("dali-btn--destructive");
    expect(document.activeElement).not.toBe(del);
    cleanup();
  });

  it("disables Cancel while an onConfirm action runs", async () => {
    const { container, api, cleanup } = setup();
    let finish!: () => void;
    await act(async () => {
      void api.confirm({ title: "Send?", confirmLabel: "Send", onConfirm: () => new Promise<void>((r) => { finish = r; }) });
    });
    clickButton(container, "Send");
    expect(cancelButton(container).disabled).toBe(true);
    await act(async () => { finish(); });
    cleanup();
  });

  it("prompt wraps its field in .os-form with no coral focus ring", async () => {
    const { container, api, cleanup } = setup();
    await act(async () => { void api.prompt({ title: "Rename", label: "Name" }); });
    const input = container.querySelector("input[type='text']")!;
    expect(input.closest(".os-form")).not.toBeNull();
    expect(input.className).not.toContain("coral");
    expect(container.querySelector("h2")!.className).toBe(MODAL_TITLE_CLASS);
    cleanup();
  });

  it("choice rows are os wells, not coral-tinted cards", async () => {
    const { container, api, cleanup } = setup();
    await act(async () => {
      void api.choice({ title: "Pick", options: [{ value: "a", label: "Alpha" }] });
    });
    const row = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Alpha"))!;
    expect(row.classList.contains("bg-os-well")).toBe(true);
    expect(ownCoral(container)).toEqual([]);
    expect(cancelButton(container).classList.contains("os-btn-ghost")).toBe(true);
    cleanup();
  });

  it("marks the selected choice as current and keeps it from being picked", async () => {
    const { container, api, cleanup } = setup();
    let result: Promise<string | null> = Promise.resolve(null);
    await act(async () => {
      result = api.choice({
        title: "Pick",
        selected: "b",
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Beta" },
        ],
      });
    });
    const rows = Array.from(container.querySelectorAll("button"));
    const alpha = rows.find((b) => b.textContent?.includes("Alpha"))!;
    const beta = rows.find((b) => b.textContent?.includes("Beta"))!;
    expect(beta.disabled).toBe(true);
    expect(beta.getAttribute("aria-current")).toBe("true");
    expect(beta.textContent).toContain("Current");
    expect(alpha.disabled).toBe(false);
    expect(alpha.getAttribute("aria-current")).toBeNull();
    expect(alpha.textContent).not.toContain("Current");
    await act(async () => alpha.click());
    await expect(result).resolves.toBe("a");
    cleanup();
  });

  it("marks nothing current without a selection", async () => {
    const { container, api, cleanup } = setup();
    await act(async () => {
      void api.choice({ title: "Pick", options: [{ value: "a", label: "Alpha" }] });
    });
    expect(container.querySelector("[aria-current]")).toBeNull();
    cleanup();
  });
});
