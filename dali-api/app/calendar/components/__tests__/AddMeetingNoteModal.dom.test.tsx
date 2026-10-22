// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: undefined, submit: vi.fn() }),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/calendar/lib/useFiledNoteToast", () => ({ useFiledNoteToast: () => vi.fn() }));
vi.mock("~/calendar/lib/useSeriesNotebook", () => ({
  useSeriesNotebook: () => ({ offerFutureFiling: vi.fn() }),
}));
vi.mock("~/calendar/components/MeetingNoteFields", async () => {
  const { NotebookPicker } = await import("~/components/notebooks/NotebookPicker");
  return {
    useMeetingNote: () => ({ state: {}, setEnabled: () => {} }),
    meetingNoteValid: () => false,
    meetingNotePayload: () => ({ notebook: null }),
    inviteOf: () => ({}),
    MeetingNoteFields: () => {
      const [open, setOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement("button", { type: "button", onClick: () => setOpen(true) }, "Search notebooks"),
        createElement(NotebookPicker, {
          open,
          onClose: () => setOpen(false),
          onPick: () => {},
          preloaded: { rows: [], status: "ready" },
        }),
      );
    },
  };
});

const { AddMeetingNoteButton } = await import("~/calendar/components/AddMeetingNoteModal");

let container: HTMLDivElement;
let root: Root;

const button = (label: string) =>
  Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const heading = (text: string) =>
  Array.from(document.body.querySelectorAll("h2")).find((h) => h.textContent === text);
const zOf = (el: Element) => Number(/(?:^|\s)z-\[?(\d+)\]?(?:\s|$)/.exec(el.className)?.[1]);
const hostOverlay = () => heading("Add meeting notes")!.closest(".fixed") as HTMLElement;
const pickerOverlay = () => heading("Add to a notebook")?.closest(".os-modal-overlay") as HTMLElement | undefined;

async function click(el: HTMLElement | undefined) {
  await act(async () => el!.click());
}
function pressEscape() {
  act(() => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(AddMeetingNoteButton, { meetingId: "m1" })));
  await click(button("Add meeting notes"));
  await act(async () => {});
  await click(button("Search notebooks"));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AddMeetingNoteModal with the notebook picker open", () => {
  it("stacks the picker above the Add meeting notes modal", () => {
    expect(pickerOverlay()).toBeTruthy();
    expect(zOf(pickerOverlay()!)).toBeGreaterThan(zOf(hostOverlay()));
  });

  it("closes only the picker on Escape", () => {
    pressEscape();
    expect(pickerOverlay()).toBeUndefined();
    expect(heading("Add meeting notes")).toBeTruthy();
  });

  it("closes the Add meeting notes modal on a second Escape", () => {
    pressEscape();
    pressEscape();
    expect(heading("Add meeting notes")).toBeUndefined();
  });
});

describe("AddMeetingNoteModal while the meeting context is still loading", () => {
  it("shows the notebook fields without waiting for it", async () => {
    act(() => root.unmount());
    container.remove();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(AddMeetingNoteButton, { meetingId: "m1" })));
    await click(button("Add meeting notes"));
    expect(button("Search notebooks")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Loading");
  });
});
