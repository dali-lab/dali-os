// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modalProps: Record<string, unknown>[] = [];
vi.mock("~/components/Modal", () => ({
  MODAL_TITLE_CLASS: "",
  Modal: (props: Record<string, unknown> & { children: React.ReactNode }) => {
    modalProps.push(props);
    return createElement("div", { role: "dialog" }, props.children as React.ReactNode);
  },
  ModalHeader: ({ title }: { title: string }) => createElement("h2", null, title),
  ModalFooter: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));
vi.mock("~/components/doc", () => ({ rawUploadUrl: (key: string) => key }));
vi.mock("~/lib/upload-client", () => ({ uploadFileToS3: vi.fn() }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn(), alert: vi.fn(), prompt: vi.fn() }) }));

import { CoverStudio } from "../CoverStudio";
import { ShareWorkModal } from "../crit/ShareWorkModal";
import { SubmissionOverlay } from "../crit/SubmissionOverlay";
import { CollectionView } from "~/components/doc/components/CollectionView";

let container: HTMLDivElement;
let root: Root;
function mount(node: React.ReactElement) {
  modalProps.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const expectDefaultLayer = (labelledBy: string) => {
  const own = modalProps.filter((p) => p.labelledBy === labelledBy);
  expect(own.length).toBeGreaterThan(0);
  for (const p of own) {
    expect(p.className).toBeUndefined();
    expect(p.layer).toBeUndefined();
    expect(String(p.containerClassName)).toContain("os-modal-card");
  }
};

describe("hub overlays use the default modal layer", () => {
  it("cover studio", () => {
    mount(createElement(CoverStudio, { busy: false, heading: "New hub", submitLabel: "Create", initialTitle: "", initialCover: null, onClose: vi.fn(), onSubmit: vi.fn() }));
    expectDefaultLayer("cover-studio-title");
  });
  it("share work", () => {
    mount(createElement(ShareWorkModal, { userName: "Ada", busy: false, serverError: null, onClose: vi.fn(), onSubmit: vi.fn() }));
    expectDefaultLayer("share-work-title");
  });
  it("crit submission", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ comments: [] }) })));
    const submission = { id: "s1", title: "Logo", question: null, kind: "image", url: "/a.png", previewUrl: null, fileName: "a.png", anonymous: false, authorName: "Ada", mine: true, canDelete: true, commentCount: 0, createdAt: new Date(0).toISOString() };
    mount(createElement(SubmissionOverlay, { pageId: "p1", submission, onClose: vi.fn(), onChanged: vi.fn() }));
    expectDefaultLayer("crit-overlay-title");
  });
  it("resource component", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
    mount(createElement(CollectionView, { fields: { title: "Kit" }, items: [{ title: "Figma", description: "", category: "", icon: "link", href: "https://www.figma.com" }] }));
    const tile = container.querySelector(".dali-cmp-coll__name")!;
    act(() => tile.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
    expectDefaultLayer("coll-overlay-title");
  });
});
