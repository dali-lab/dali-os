// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => createElement("div", { role: "dialog" }, children),
  ModalHeader: ({ title, hideClose, onClose }: { title: string; hideClose?: boolean; onClose: () => void }) =>
    createElement("div", null, createElement("h2", null, title), !hideClose && createElement("button", { type: "button", "aria-label": "Close", onClick: onClose })),
  ModalFooter: ({ children, onCancel }: { children: React.ReactNode; onCancel: () => void }) =>
    createElement("div", null, createElement("button", { type: "button", onClick: onCancel }, "Cancel"), children),
}));
vi.mock("~/components/doc", () => ({ rawUploadUrl: (key: string) => `/api/upload/raw?key=${encodeURIComponent(key)}` }));
vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: vi.fn(async () => ({ s3Key: "uploads/references/a.png" })) }));

import { uploadFileToS3 } from "~/lib/upload-client";
import { ReferenceModal, type ReferenceValues } from "../ReferenceModal";

let container: HTMLDivElement;
let root: Root;
const onSubmit = vi.fn<(v: ReferenceValues) => void>();

function mount(props: Partial<Parameters<typeof ReferenceModal>[0]> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(ReferenceModal, { busy: false, serverError: null, onClose: vi.fn(), onSubmit, ...props })));
}

const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const click = (el: Element) => act(() => (el as HTMLElement).click());
const submitButton = () => q<HTMLButtonElement>("button[type='submit']");
const submit = async () => {
  await act(async () => {
    q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(600)));
const madeThis = () => q<HTMLInputElement>("input[type='checkbox']");
const creatorInput = () => [...container.querySelectorAll("label")].find((l) => l.textContent?.includes("Creator or source"))?.querySelector("input") ?? null;

beforeEach(() => {
  vi.useFakeTimers();
  onSubmit.mockReset();
  vi.mocked(uploadFileToS3).mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ title: "Linear — The system for product work", image: "https://img.example/og.png", description: null }) })),
  );
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("adding a reference", () => {
  it("needs a link or a file before it can be added", () => {
    mount();
    expect(submitButton().disabled).toBe(true);
    type(q("input[type='url']"), "not a link");
    expect(submitButton().disabled).toBe(true);
    type(q("input[type='url']"), "https://linear.app");
    expect(submitButton().disabled).toBe(false);
  });

  it("fills the title and shows a preview from the pasted link", async () => {
    mount();
    type(q("input[type='url']"), "https://linear.app");
    await settle();
    expect(q<HTMLInputElement>("input[type='text']").value).toBe("Linear — The system for product work");
    expect(q<HTMLImageElement>("img").src).toBe("https://img.example/og.png");
  });

  it("does not overwrite a title the member already edited", async () => {
    mount();
    type(q("input[type='text']"), "My own title");
    type(q("input[type='url']"), "https://linear.app");
    await settle();
    expect(q<HTMLInputElement>("input[type='text']").value).toBe("My own title");
  });

  it("submits a link as someone else's work by default, with the credit and note", async () => {
    mount();
    type(q("input[type='url']"), "https://linear.app");
    await settle();
    type(creatorInput()!, "Linear");
    type(q("textarea"), "Great empty states");
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "link", url: "https://linear.app", fileName: "", title: "Linear — The system for product work", creator: "other", creatorName: "Linear", note: "Great empty states",
    });
  });

  it("marks my work with a checkbox at the bottom, and drops the creator field and any name typed into it", async () => {
    mount();
    expect(madeThis().checked).toBe(false);
    expect(container.textContent).toContain("I made this");
    type(q("input[type='url']"), "https://dali.example/work");
    type(creatorInput()!, "Someone");
    click(madeThis());
    expect(creatorInput()).toBeNull();
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ creator: "mine", creatorName: "" }));
  });

  it("uploads a picked image first, titles it from the file name and submits the upload", async () => {
    mount();
    const input = q<HTMLInputElement>("input[type='file']");
    const file = new File(["x"], "Moodboard v2.png", { type: "image/png" });
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(q<HTMLInputElement>("input[type='text']").value).toBe("Moodboard v2");
    expect(container.textContent).toContain("Moodboard v2.png");
    await submit();
    expect(uploadFileToS3).toHaveBeenCalledWith(file, "references", expect.stringContaining("image/*"));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", fileName: "Moodboard v2.png", url: expect.stringContaining("uploads%2Freferences%2Fa.png") }));
  });

  it("shows an upload failure and does not submit", async () => {
    vi.mocked(uploadFileToS3).mockRejectedValueOnce(new Error("Too big"));
    mount();
    const input = q<HTMLInputElement>("input[type='file']");
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.pdf", { type: "application/pdf" })], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    await submit();
    expect(container.querySelector("[role='alert']")?.textContent).toBe("Too big");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hides the close button while the upload runs and ignores a result that arrives after the modal is gone", async () => {
    let finish!: (v: { s3Key: string }) => void;
    vi.mocked(uploadFileToS3).mockReturnValueOnce(new Promise((r) => (finish = r)) as never);
    mount();
    const input = q<HTMLInputElement>("input[type='file']");
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.png", { type: "image/png" })], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(q("[aria-label='Close']")).not.toBeNull();
    await submit();
    expect(q("[aria-label='Close']")).toBeNull();
    act(() => root.unmount());
    await act(async () => finish({ s3Key: "uploads/references/a.png" }));
    expect(onSubmit).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("removes a picked file with the shared icon button", () => {
    mount();
    const input = q<HTMLInputElement>("input[type='file']");
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn();
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.pdf", { type: "application/pdf" })], configurable: true });
    act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
    click(q("[aria-label='Remove file']"));
    expect(q("input[type='url']")).not.toBeNull();
  });

  it("shows the server's error", () => {
    mount({ serverError: "Enter a web link, like https://…" });
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Enter a web link");
  });
});

describe("editing a reference", () => {
  const reference = { title: "Linear", daliMade: false, creatorName: "Karri", note: "Nice" };

  it("hides the link and file picker, and starts from what was saved", () => {
    mount({ reference });
    expect(q("input[type='url']")).toBeNull();
    expect(q("input[type='file']")).toBeNull();
    expect(q<HTMLInputElement>("input[type='text']").value).toBe("Linear");
    expect(creatorInput()!.value).toBe("Karri");
    expect(q<HTMLTextAreaElement>("textarea").value).toBe("Nice");
    expect(madeThis().checked).toBe(false);
  });

  it("opens with I made this checked for a DALI-made reference", () => {
    mount({ reference: { ...reference, daliMade: true, creatorName: null } });
    expect(madeThis().checked).toBe(true);
    expect(creatorInput()).toBeNull();
  });

  it("does not carry the sharer's own name into the creator field when unchecking I made this", async () => {
    mount({ reference: { title: "Mine", daliMade: true, creatorName: "Ada Lovelace", note: null } });
    click(madeThis());
    expect(creatorInput()!.value).toBe("");
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ creator: "other", creatorName: "" }));
  });

  it("saves the changes without touching the attachment", async () => {
    mount({ reference });
    type(q("input[type='text']"), "Linear app");
    click(madeThis());
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: "Linear app", creator: "mine", creatorName: "", note: "Nice" }));
    expect(uploadFileToS3).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cannot be saved without a title", () => {
    mount({ reference });
    type(q("input[type='text']"), "  ");
    expect(submitButton().disabled).toBe(true);
  });
});
