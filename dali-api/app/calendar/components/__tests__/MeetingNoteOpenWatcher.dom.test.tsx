// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/calendar/lib/useFiledNoteToast", () => ({ useFiledNoteToast: () => vi.fn() }));

const { useOpenMeetingNote } = await import("~/calendar/components/AddMeetingNoteModal");
const { MeetingNoteOpenWatcher } = await import("~/calendar/components/MeetingNoteOpenWatcher");

let container: HTMLDivElement;
let root: Root;

function OpenButton() {
  const note = useOpenMeetingNote({ meetingId: "m1", occurrenceStart: "2026-10-20T14:00:00.000Z" });
  return createElement("button", { type: "button", onClick: note.open }, "Open note");
}

function Popover() {
  const [open, setOpen] = useState(true);
  return createElement(
    "div",
    null,
    open && createElement("div", { onClick: () => setOpen(false) }, createElement(OpenButton)),
  );
}

function Page() {
  return createElement("div", null, createElement(MeetingNoteOpenWatcher), createElement(Popover));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("opening a meeting note", () => {
  it("still navigates to the note when the button that asked is gone before the answer", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: Page,
        loader: () => null,
        action: async () => {
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, notePageId: "note-9" };
        },
      },
      { path: "/documents/:id", Component: () => createElement("p", null, "Document page") },
    ]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(Stub, { initialEntries: ["/"] })));

    await act(async () => container.querySelector("button")!.click());
    expect(container.querySelector("button")).toBeNull();
    await act(async () => void (await new Promise((r) => setTimeout(r, 120))));

    expect(container.textContent).toContain("Document page");
  });
});
