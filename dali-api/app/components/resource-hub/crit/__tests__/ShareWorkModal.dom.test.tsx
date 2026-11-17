// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => createElement("div", { role: "dialog" }, children),
  ModalHeader: ({ title, hideClose, onClose }: { title: string; hideClose?: boolean; onClose: () => void }) =>
    createElement("div", null, createElement("h2", null, title), !hideClose && createElement("button", { type: "button", "aria-label": "Close", onClick: onClose })),
  ModalFooter: ({ children, onCancel, cancelDisabled }: { children: React.ReactNode; onCancel: () => void; cancelDisabled?: boolean }) =>
    createElement("div", null, createElement("button", { type: "button", disabled: cancelDisabled, onClick: onCancel }, "Cancel"), children),
}));
vi.mock("~/components/doc", () => ({ rawUploadUrl: (key: string) => `/api/upload/raw?key=${encodeURIComponent(key)}` }));
vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: vi.fn() }));

import { uploadFileToS3 } from "~/lib/upload-client";
import { ShareWorkModal, type ShareValues } from "../ShareWorkModal";

let container: HTMLDivElement;
let root: Root;
const onSubmit = vi.fn<(v: ShareValues) => void>();

const props = { userName: "Ada Lovelace", busy: false, serverError: null, onClose: vi.fn(), onSubmit };
const render = (over: Partial<typeof props> = {}) => act(() => root.render(createElement(ShareWorkModal, { ...props, ...over })));
const q = <T extends Element>(sel: string) => container.querySelector(sel) as T;
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const linkInput = () => [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Link"))!.querySelector("input") as HTMLInputElement;
const submitButton = () => q<HTMLButtonElement>("button[type='submit']");
const submit = () =>
  act(async () => {
    q<HTMLFormElement>("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const pickFile = (file: File) => {
  const input = q<HTMLInputElement>("input[type='file']");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  act(() => void input.dispatchEvent(new Event("change", { bubbles: true })));
};
const closeButton = () => q<HTMLButtonElement>("[aria-label='Close']");

beforeEach(() => {
  onSubmit.mockReset();
  props.onClose.mockReset();
  vi.mocked(uploadFileToS3).mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("what can be posted", () => {
  it("needs a web link or a file", async () => {
    expect(submitButton().disabled).toBe(true);
    type(linkInput(), "not a link");
    expect(submitButton().disabled).toBe(true);
    type(linkInput(), "https://figma.com/file/abc");
    expect(submitButton().disabled).toBe(false);
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "link", url: "https://figma.com/file/abc", anonymous: false }));
    expect(uploadFileToS3).not.toHaveBeenCalled();
  });

  it("does not submit an empty form", async () => {
    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uploads a picked image and submits the upload with the title and question", async () => {
    vi.mocked(uploadFileToS3).mockResolvedValue({ s3Key: "uploads/crit-wall/a.png" } as never);
    pickFile(new File(["x"], "logo.png", { type: "image/png" }));
    type(q("input[maxlength='120']"), "Logo v2");
    type(q("textarea"), "Is it bold enough?");
    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      kind: "image", url: expect.stringContaining("uploads%2Fcrit-wall%2Fa.png"), fileName: "logo.png", title: "Logo v2", question: "Is it bold enough?", anonymous: false,
    });
  });

  it("treats a non-image upload as a file", async () => {
    vi.mocked(uploadFileToS3).mockResolvedValue({ s3Key: "uploads/crit-wall/a.pdf" } as never);
    pickFile(new File(["x"], "deck.pdf", { type: "application/pdf" }));
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "file", fileName: "deck.pdf" }));
  });

  it("shows an upload failure and does not submit", async () => {
    vi.mocked(uploadFileToS3).mockRejectedValue(new Error("Too big"));
    pickFile(new File(["x"], "a.pdf", { type: "application/pdf" }));
    await submit();
    expect(q("[role='alert']").textContent).toBe("Too big");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the server's error", () => {
    render({ serverError: "Enter a web link, like https://…" });
    expect(q("[role='alert']").textContent).toContain("Enter a web link");
  });
});

describe("posting as", () => {
  it("offers the member's name and Anonymous, defaulting to the name", async () => {
    const radios = [...container.querySelectorAll<HTMLInputElement>("input[type='radio']")];
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(["Ada Lovelace", "Anonymous"]);
    expect(radios[0].checked).toBe(true);
  });

  it("submits anonymous when Anonymous is chosen", async () => {
    type(linkInput(), "https://example.com");
    act(() => void [...container.querySelectorAll<HTMLInputElement>("input[type='radio']")][1].click());
    await submit();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ anonymous: true }));
  });
});

describe("while uploading", () => {
  const startUpload = async () => {
    let finish!: (v: { s3Key: string }) => void;
    vi.mocked(uploadFileToS3).mockReturnValue(new Promise((r) => (finish = r)) as never);
    pickFile(new File(["x"], "a.png", { type: "image/png" }));
    await submit();
    return finish;
  };

  it("hides the close button and disables Cancel", async () => {
    expect(closeButton()).not.toBeNull();
    await startUpload();
    expect(closeButton()).toBeNull();
    expect([...container.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.disabled).toBe(true);
  });

  it("submits once the upload finishes", async () => {
    const finish = await startUpload();
    await act(async () => finish({ s3Key: "uploads/crit-wall/a.png" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores an upload that finishes after the modal is gone", async () => {
    const finish = await startUpload();
    act(() => root.unmount());
    await act(async () => finish({ s3Key: "uploads/crit-wall/a.png" }));
    expect(onSubmit).not.toHaveBeenCalled();
    root = createRoot(container);
  });
});
