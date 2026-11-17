// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ReferenceCard } from "../ReferenceCard";
import { ReferenceOverlay } from "../ReferenceOverlay";
import type { ReferenceView } from "~/lib/references.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/Modal", () => ({
  Modal: ({ children }: { children: React.ReactNode }) => createElement("div", { role: "dialog" }, children),
  ModalHeader: ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) =>
    createElement("div", null, createElement("h2", null, title), subtitle && createElement("p", null, subtitle), actions),
}));
vi.mock("~/components/FilePreview", () => ({ FilePreview: ({ fileName }: { fileName: string }) => createElement("div", { "data-testid": "file-preview" }, fileName) }));

const item = (o: Partial<ReferenceView> = {}): ReferenceView => ({
  id: "r1", title: "Linear", kind: "link", url: "https://linear.app/", previewUrl: "https://img.example/og.png", fileName: null, creatorName: "Karri Saarinen", sharedBy: "Ada Lovelace",
  daliMade: false, note: null, mine: false, canDelete: false, createdAt: "2026-11-14T00:00:00.000Z", ...o,
});

let container: HTMLDivElement;
let root: Root;
const handlers = { onOpen: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() };

function mount(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(MemoryRouter, null, node)));
}
const card = (o: Partial<ReferenceView> = {}) => mount(createElement("ul", null, createElement(ReferenceCard, { item: item(o), ...handlers })));
const menuRows = () => [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")];

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Object.values(handlers).forEach((h) => h.mockReset());
});

describe("ReferenceCard", () => {
  it("opens a link in a new tab and never in the gallery's own", () => {
    card();
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://linear.app/");
    expect(a.target).toBe("_blank");
    expect(a.rel).toContain("noopener");
  });

  it("opens an image or document in the overlay instead", () => {
    card({ kind: "image", url: "/api/upload/raw?key=uploads%2Fa.png" });
    expect(container.querySelector("a")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>("li > button")!.click());
    expect(handlers.onOpen).toHaveBeenCalledTimes(1);
  });

  it("credits someone else's work to its creator and says who shared it, with no badge", () => {
    card();
    expect(container.textContent).toContain("Karri Saarinen");
    expect(container.textContent).toContain("Shared by Ada Lovelace");
    expect(container.textContent).not.toContain("DALI-made");
  });

  it("badges DALI-made work and names its maker once", () => {
    card({ daliMade: true, creatorName: "Ada Lovelace" });
    expect(container.textContent).toContain("DALI-made");
    expect(container.textContent).not.toContain("Shared by");
    expect(container.textContent?.match(/Ada Lovelace/g)).toHaveLength(1);
  });

  it("falls back to who shared it when there is no creator, and shows the note", () => {
    card({ creatorName: null, note: "Great empty states" });
    expect(container.textContent).toContain("Shared by Ada Lovelace");
    expect(container.textContent).toContain("Great empty states");
  });

  it("shows an icon and the site when there is no thumbnail", () => {
    card({ previewUrl: null });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("linear.app");
  });

  it("has no actions menu for a reference the viewer can't manage", () => {
    card();
    expect(container.querySelector("[aria-label^='Actions']")).toBeNull();
  });

  it("offers edit and delete to the poster", () => {
    card({ mine: true, canDelete: true });
    act(() => container.querySelector<HTMLButtonElement>("[aria-label^='Actions']")!.click());
    expect(menuRows().map((r) => r.textContent)).toEqual(["Edit", "Delete"]);
    act(() => menuRows()[0]!.click());
    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
  });

  it("offers a moderator delete only", () => {
    card({ mine: false, canDelete: true });
    act(() => container.querySelector<HTMLButtonElement>("[aria-label^='Actions']")!.click());
    expect(menuRows().map((r) => r.textContent)).toEqual(["Delete"]);
    act(() => menuRows()[0]!.click());
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("ReferenceOverlay", () => {
  it("shows an image large with its credit and note", () => {
    mount(createElement(ReferenceOverlay, { item: item({ kind: "image", url: "/img.png", note: "Love the spacing" }), onClose: vi.fn() }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/img.png");
    expect(container.textContent).toContain("Karri Saarinen · Shared by Ada Lovelace");
    expect(container.textContent).toContain("Love the spacing");
  });

  it("previews a document and offers the original", () => {
    mount(createElement(ReferenceOverlay, { item: item({ kind: "file", url: "/doc.pdf", fileName: "brief.pdf" }), onClose: vi.fn() }));
    expect(container.querySelector("[data-testid='file-preview']")?.textContent).toBe("brief.pdf");
    expect(container.textContent).toContain("Open original");
  });

  it("badges DALI-made work", () => {
    mount(createElement(ReferenceOverlay, { item: item({ kind: "image", url: "/img.png", daliMade: true, creatorName: "Ada Lovelace" }), onClose: vi.fn() }));
    expect(container.textContent).toContain("DALI-made");
    expect(container.textContent).not.toContain("Shared by");
  });
});
