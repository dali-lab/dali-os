// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const submit = vi.fn();
vi.mock("react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  useFetcher: () => ({ submit, data: undefined, formData: undefined, Form: "form" }),
}));
vi.mock("~/components/os-chrome", () => ({
  useOsChrome: () => ({ heading: "" }),
  modalCardClass: () => "",
}));
vi.mock("~/components/Modal", () => ({
  Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? children : null),
  ModalHeader: ({ title }: { title: string }) => createElement("h2", null, title),
}));
vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("~/components/ui/dialog", () => ({ useConfirmSubmit: () => vi.fn() }));
let emitChange: (blocks: unknown) => void = () => {};
vi.mock("~/components/doc", () => ({
  DocEditor: ({ onChange }: { onChange: (b: unknown) => void }) => {
    emitChange = onChange;
    return createElement("div", { "data-doc": true });
  },
}));

import { FormSettingsDialog } from "~/forms/components/FormSettings";

let root: Root;
let container: HTMLDivElement;

const MESSAGE = [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }];

function mount(over: Record<string, unknown> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      createElement(FormSettingsDialog, {
        open: true,
        onClose: () => {},
        managing: null,
        usages: [],
        hiringLinks: [],
        formId: "f1",
        oneResponsePerMember: false,
        allowResponseEdit: false,
        remindBeforeClose: false,
        confirmationMessage: null,
        sendReceipt: false,
        audience: "Members",
        hasEmailQuestion: false,
        notifyOnSubmission: false,
        listed: false,
        opensAt: null,
        closesAt: null,
        ...over,
      } as never),
    );
  });
  return container;
}

const text = () => container.textContent ?? "";
const checkbox = () =>
  [...container.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((c) =>
    c.closest("label")?.textContent?.includes("Email people a copy"),
  );

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  submit.mockClear();
});

describe("After submitting settings", () => {
  it("shows the confirmation message and receipt settings", () => {
    mount();
    expect(text()).toContain("After submitting");
    expect(text()).toContain("Confirmation message");
    expect(text()).toContain("Email people a copy of their response");
  });

  it("doesn't save per keystroke, only when Save message is pressed", () => {
    mount();
    act(() => emitChange(MESSAGE));
    act(() => emitChange([...MESSAGE, ...MESSAGE]));
    expect(submit).not.toHaveBeenCalled();
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save message")!;
    act(() => save.click());
    expect(submit).toHaveBeenCalledTimes(1);
    const body = submit.mock.calls[0][0];
    expect(body.intent).toBe("update-form-settings");
    expect(JSON.parse(body.confirmationMessage)).toHaveLength(2);
  });

  it("sends an empty string to clear when the editor is emptied", () => {
    mount({ confirmationMessage: MESSAGE });
    act(() => emitChange([{ type: "paragraph", content: [] }]));
    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save message")!;
    act(() => save.click());
    expect(submit.mock.calls[0][0].confirmationMessage).toBe("");
  });

  it("toggling the receipt saves it", () => {
    mount();
    act(() => checkbox()!.click());
    expect(submit.mock.calls[0][0].sendReceipt).toBe("true");
  });

  it("explains the public receipt only on public forms", () => {
    mount({ hasEmailQuestion: true });
    expect(text()).not.toContain("who aren't signed in");
    act(() => root.unmount());
    container.remove();
    mount({ audience: "Public", hasEmailQuestion: true });
    expect(text()).toContain(
      "People who aren't signed in get a short note at the first Email question, without their answers.",
    );
  });

  it("prompts for an Email question on a public form without one", () => {
    mount({ audience: "Public", hasEmailQuestion: false });
    expect(text()).toContain("Add an Email question so people who aren't signed in get a copy too.");
    expect(text()).not.toContain("short note");
  });
});
