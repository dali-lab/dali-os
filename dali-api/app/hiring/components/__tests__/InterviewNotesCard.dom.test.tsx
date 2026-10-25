// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const docEditorProps: Record<string, unknown>[] = [];
vi.mock("react-router", () => ({ Link: () => null }));
vi.mock("~/components/doc", () => ({
  DocEditor: (props: Record<string, unknown>) => {
    docEditorProps.push(props);
    return createElement("div", { "data-testid": "doc" });
  },
}));

const { InterviewNotesCard } = await import("~/hiring/components/InterviewNotesCard");
type Data = Parameters<typeof InterviewNotesCard>[0]["interview"];

const toggleHeading = {
  id: "b1",
  type: "heading",
  props: { level: 2, isToggleable: true },
  content: [{ type: "text", text: "Technical", styles: {} }],
  children: [{ id: "b2", type: "paragraph", props: {}, content: [{ type: "text", text: "Strong on systems", styles: {} }], children: [] }],
};
const emptyParagraph = { id: "e1", type: "paragraph", props: {}, content: [], children: [] };

function interview(jointNotes: Data["jointNotes"]): Data {
  return { id: "iv1", startTime: "2026-10-10T14:00:00Z", status: "Completed", jointNotes };
}

let root: Root;
let host: HTMLDivElement;

async function mount(data: Data, variant?: "full" | "compact") {
  docEditorProps.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(InterviewNotesCard, { interview: data, variant }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("InterviewNotesCard joint notes", () => {
  for (const variant of ["full", "compact"] as const) {
    it(`renders the doc read-only in the notes preset (${variant})`, async () => {
      await mount(interview({ blocks: [toggleHeading], updatedAt: null }), variant);

      expect(host.querySelectorAll("[data-testid=doc]")).toHaveLength(1);
      expect(docEditorProps[0]).toMatchObject({
        features: "notes",
        editable: false,
        initialContent: [toggleHeading],
      });
    });
  }

  it("shows the empty state for a doc with no content", async () => {
    await mount(interview({ blocks: [emptyParagraph], updatedAt: "2026-10-10T15:00:00Z" }));

    expect(host.querySelector("[data-testid=doc]")).toBeNull();
    expect(host.textContent).toContain("No notes yet.");
    expect(host.textContent).not.toContain("Last edit");
  });

  it("shows the empty state when there are no joint notes", async () => {
    await mount(interview(null), "compact");

    expect(host.querySelector("[data-testid=doc]")).toBeNull();
    expect(host.textContent).toContain("No interview notes.");
  });

  it("shows the last edit time under the notes", async () => {
    await mount(interview({ blocks: [toggleHeading], updatedAt: "2026-10-10T15:00:00Z" }));

    expect(host.textContent).toContain("Last edit");
  });

  it("omits the last edit line when the time is unknown", async () => {
    await mount(interview({ blocks: [toggleHeading], updatedAt: null }));

    expect(host.textContent).not.toContain("Last edit");
  });
});
