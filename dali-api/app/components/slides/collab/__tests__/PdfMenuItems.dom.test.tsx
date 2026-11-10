// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("~/components/shell/page-bar-slot", () => ({ PageBarMenuItems: (p: { children: React.ReactNode }) => createElement("div", null, p.children) }));
vi.mock("~/components/ui/floating", () => ({
  Menu: { Item: (p: { children: React.ReactNode; onSelect: () => void }) => createElement("button", { onClick: p.onSelect }, p.children) },
}));

import { DeckPdfMenuItems } from "../PdfMenuItems";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();
beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
  vi.stubGlobal("location", { assign });
  assign.mockClear();
});
afterEach(() => act(() => root.unmount()));

const items = (canExportNotes: boolean) => {
  act(() => root.render(createElement(DeckPdfMenuItems, { pageId: "p 1", canExportNotes })));
  return [...container.querySelectorAll("button")];
};

describe("DeckPdfMenuItems", () => {
  it("offers Download PDF that navigates to the export", () => {
    const [pdf] = items(false);
    expect(pdf.textContent).toBe("Download PDF");
    act(() => pdf.click());
    expect(assign).toHaveBeenCalledWith("/slides/p%201/export.pdf");
  });

  it("offers notes only to people who can edit", () => {
    expect(items(false)).toHaveLength(1);
    const all = items(true);
    expect(all.map((b) => b.textContent)).toEqual(["Download PDF", "Download PDF with notes"]);
    act(() => all[1].click());
    expect(assign).toHaveBeenCalledWith("/slides/p%201/export.pdf?notes=1");
  });
});
