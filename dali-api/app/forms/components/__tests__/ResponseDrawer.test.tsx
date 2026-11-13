// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/Drawer", () => ({
  Drawer: ({ open, title, children, footer }: { open: boolean; title: string; children: React.ReactNode; footer?: React.ReactNode }) =>
    open ? createElement("section", null, createElement("h2", null, title), children, footer) : null,
}));

import { ResponseDrawer } from "../ResponseDrawer";

let container: HTMLDivElement;
let root: Root | undefined;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
});

async function render(props: Partial<Parameters<typeof ResponseDrawer>[0]>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(ResponseDrawer, { open: true, onClose: () => {}, title: "Ada Example", fields: [], ...props }),
    ),
  );
}

describe("ResponseDrawer", () => {
  it("lists every field with a dash for blanks and notes beside labels", async () => {
    await render({
      subtitle: "ada@example.edu",
      fields: [
        { key: "a", label: "Coming back?", value: "Yes" },
        { key: "b", label: "Notes", value: "", note: "Not in the table" },
      ],
      footer: createElement("button", null, "Delete response"),
    });
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual([
      "Coming back?",
      "NotesNot in the table",
    ]);
    expect([...container.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["Yes", "—"]);
    expect(container.textContent).toContain("ada@example.edu");
    expect(container.textContent).toContain("Delete response");
  });

  it("keeps the subtitle outside the scrolling fields so it isn't clipped", async () => {
    await render({ subtitle: "Nov 11, 2026", fields: [{ key: "a", label: "Name", value: "Ada" }] });
    const subtitle = [...container.querySelectorAll("p")].find((p) => p.textContent === "Nov 11, 2026")!;
    expect(subtitle.closest(".overflow-y-auto")).toBeNull();
    expect(subtitle.className).not.toMatch(/-mt-/);
  });

  it("links uploaded files", async () => {
    await render({
      fields: [{ key: "f", label: "Resume", value: "cv.pdf", files: [{ name: "cv.pdf", key: "uploads/cv.pdf" }] }],
    });
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/api/upload/raw?key=uploads%2Fcv.pdf");
  });

  it("renders nothing while closed", async () => {
    await render({ open: false });
    expect(container.textContent).toBe("");
  });
});
