// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import AskPanel, { footerNote, resetTime, sourceMeta } from "../components/AskPanel";
import { linkCitations } from "../components/AskAnswer";
import { newTurn, type AskThread, type AskThreadState, type AskTurn } from "../thread";
import { ASK_PANEL } from "~/lib/side-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {};

let container: HTMLDivElement;
let root: Root;

function fakeThread(state: AskThreadState) {
  return {
    getState: () => state,
    subscribe: () => () => {},
    ask: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    stop: vi.fn(),
    reset: vi.fn(),
    busy: false,
  } as unknown as AskThread & { ask: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> };
}

function mount(state: AskThreadState) {
  const thread = fakeThread(state);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <AskPanel panel={ASK_PANEL} onClose={() => {}} thread={thread} />
      </MemoryRouter>,
    ),
  );
  return thread;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
const turn = (over: Partial<AskTurn>): AskTurn => ({ ...newTurn(1, "When is the launch?"), ...over });

function type(value: string) {
  const input = document.body.querySelector<HTMLTextAreaElement>("textarea")!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

describe("AskPanel empty", () => {
  it("offers example questions and asks one when clicked", () => {
    const thread = mount({ turns: [], remaining: null });
    expect(text()).toContain("What do you want to know?");
    expect(button("Start over")).toBeUndefined();
    act(() => button("What am I on the hook for this week?")!.click());
    expect(thread.ask).toHaveBeenCalledWith("What am I on the hook for this week?");
  });

  it("has no full page link, since Ask isn't a page", () => {
    mount({ turns: [], remaining: null });
    expect(document.body.querySelector('a[aria-label="Open full page"]')).toBeNull();
  });

  it("sends with Enter and keeps Shift+Enter for a new line", () => {
    const thread = mount({ turns: [], remaining: null });
    const input = type("Who runs the design team?");
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    });
    expect(thread.ask).not.toHaveBeenCalled();
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(thread.ask).toHaveBeenCalledWith("Who runs the design team?");
    expect(input.value).toBe("");
  });

  it("keeps the send button off until there's text", () => {
    mount({ turns: [], remaining: null });
    expect(button("Ask")!.disabled).toBe(true);
    type("x");
    expect(button("Ask")!.disabled).toBe(false);
  });
});

describe("AskPanel turns", () => {
  it("shows the answer with linked citations and the cited sources", () => {
    mount({
      turns: [
        turn({
          status: "done",
          steps: [{ label: "Searching", done: true }],
          text: "It moved to **May 4** [1]. See https://evil.example/x ![x](https://evil.example/p.png)",
          answer: "It moved to **May 4** [1].",
          sources: [
            { kind: "document", title: "Kickoff notes", url: "/documents/p1", date: "2026-10-30T12:00:00Z", ref: "s1", n: 1 },
          ],
        }),
      ],
      remaining: 20,
    });
    expect(text()).toContain("When is the launch?");
    expect(text()).toContain("Searching");
    const cite = [...document.body.querySelectorAll("a")].find((a) => a.textContent === "[1]")!;
    expect(cite.getAttribute("href")).toBe("/documents/p1");
    const sourceRow = [...document.body.querySelectorAll("a")].find((a) => a.textContent?.includes("Kickoff notes"))!;
    expect(sourceRow.getAttribute("href")).toBe("/documents/p1");
    expect(document.body.querySelector('a[href^="https://"]')).toBeNull();
    expect(document.body.querySelector("img")).toBeNull();
    expect(button("Start over")).toBeTruthy();
  });

  it("starts over", () => {
    const thread = mount({ turns: [turn({ status: "done", text: "ok", answer: "ok" })], remaining: null });
    act(() => button("Start over")!.click());
    expect(thread.reset).toHaveBeenCalled();
  });

  it("shows live steps and a Stop button while thinking", () => {
    const thread = mount({
      turns: [turn({ status: "running", steps: [{ label: "Checking your tasks", done: false }] })],
      remaining: null,
    });
    expect(text()).toContain("Checking your tasks");
    expect(button("Ask")).toBeUndefined();
    act(() => button("Stop")!.click());
    expect(thread.stop).toHaveBeenCalled();
  });

  it("offers Try again on an error", () => {
    const thread = mount({ turns: [turn({ status: "error", error: "Something went wrong." })], remaining: null });
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain("Something went wrong.");
    act(() => button("Try again")!.click());
    expect(thread.retry).toHaveBeenCalledWith(1);
  });

  it("explains the daily limit and turns the field off until it resets", () => {
    const retryAt = Date.now() + 3_600_000;
    mount({ turns: [turn({ status: "limited", retryAt })], remaining: 0 });
    expect(text()).toContain("You've used today's questions");
    expect(text()).toContain(`You can ask again after ${resetTime(retryAt)}`);
    expect(document.body.querySelector("textarea")!.disabled).toBe(true);
  });

  it("says when a turn was stopped", () => {
    mount({ turns: [turn({ status: "stopped" })], remaining: null });
    expect(text()).toContain("Stopped.");
  });
});

describe("footerNote", () => {
  it("is just the AI note until few questions are left", () => {
    for (const remaining of [null, 49, 6, 0]) {
      expect(footerNote(remaining)).toEqual({ count: null, note: "Written by AI from DALI docs, meetings and tasks." });
    }
  });

  it("adds the count at five or fewer", () => {
    expect(footerNote(5).count).toBe("5 questions left today.");
    expect(footerNote(1).count).toBe("1 question left today.");
  });

  it("never names the daily total in the panel", () => {
    mount({ turns: [], remaining: 50 });
    expect(text()).not.toMatch(/50/);
  });
});

describe("sourceMeta", () => {
  it("labels the kind, with a due date for tasks", () => {
    expect(sourceMeta({ kind: "document", date: null })).toBe("Document");
    expect(sourceMeta({ kind: "transcript", date: "2026-10-30T12:00:00Z" })).toMatch(/^Transcript · /);
    expect(sourceMeta({ kind: "task", date: "2026-11-21T12:00:00Z" })).toMatch(/^Task · due /);
  });
});

describe("linkCitations", () => {
  it("turns markers into citation links and leaves existing links alone", () => {
    expect(linkCitations("A [1] and B [2][3]. [c](x)")).toBe(
      "A [1](#ask-cite-1) and B [2](#ask-cite-2)[3](#ask-cite-3). [c](x)",
    );
  });
});
