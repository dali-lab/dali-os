// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { MemberFormFillView } from "~/forms/components/MemberFormFillView";
import { progressKey } from "~/forms/lib/form-progress";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const V = "2026-10-01T00:00:00.000Z";
const q = (key: string, label: string): Question => ({
  key,
  type: "text",
  required: false,
  data: { label },
});
const pageBreak = { key: "pb", type: "pageBreak", required: false, data: { label: "" } } as unknown as Question;
const oneQuestion = [q("name", "Your name")];
const twoPages = [q("name", "Your name"), pageBreak, q("city", "Your city")];

const KEY = progressKey("tok", "v1", "u1");
const saved = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    answers: { name: "Ada" },
    pageIndex: 0,
    versionUpdatedAt: V,
    savedAt: Date.now(),
    ...over,
  });

let container: HTMLDivElement;
let root: Root;

const text = () => container.textContent ?? "";
const input = () => container.querySelector("input") as HTMLInputElement;

function render(
  props: {
    questions?: Question[];
    saveProgress?: boolean;
    userId?: string | null;
    preview?: boolean;
    editing?: { answers: Record<string, string> };
  } = {},
) {
  act(() => {
    root.render(
      createElement(MemberFormFillView, {
        data: {
          name: "Intake",
          description: null,
          versionId: "v1",
          versionUpdatedAt: V,
          questions: props.questions ?? oneQuestion,
          token: "tok",
        },
        saveProgress: props.saveProgress ?? true,
        progressUserId: props.userId === undefined ? "u1" : props.userId,
        preview: props.preview,
        editing: props.editing,
      } as never),
    );
  });
}

function type(value: string) {
  act(() => {
    const el = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const flush = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const click = (label: string) =>
  act(() => {
    [...container.querySelectorAll("button")]
      .find((b) => b.textContent?.trim() === label)!
      .click();
  });
const submit = () =>
  act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("MemberFormFillView save progress", () => {
  it("saves typed answers after 500ms, not before", () => {
    render();
    type("Ada");
    flush(499);
    expect(localStorage.getItem(KEY)).toBeNull();
    flush(1);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({
      answers: { name: "Ada" },
      pageIndex: 0,
      versionUpdatedAt: V,
    });
  });

  it("does not save empty answers", () => {
    render();
    flush(1000);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("restores answers and shows the banner", () => {
    localStorage.setItem(KEY, saved());
    render();
    expect(input().value).toBe("Ada");
    expect(text()).toContain("We saved your answers");
  });

  it("restores the page and clamps an index past the last page", () => {
    localStorage.setItem(KEY, saved({ pageIndex: 1, answers: { city: "Hanover" } }));
    render({ questions: twoPages });
    expect(text()).toContain("Step 2 of 2");
    act(() => root.unmount());
    root = createRoot(container);
    localStorage.setItem(KEY, saved({ pageIndex: 9, answers: { city: "Hanover" } }));
    render({ questions: twoPages });
    expect(text()).toContain("Step 2 of 2");
  });

  it("shows no banner when nothing was restored", () => {
    render();
    expect(text()).not.toContain("We saved your answers");
  });

  it("Start over clears answers, page, banner and storage", () => {
    localStorage.setItem(KEY, saved({ pageIndex: 1, answers: { city: "Hanover" } }));
    render({ questions: twoPages });
    click("Start over");
    flush(1000);
    expect(text()).toContain("Step 1 of 2");
    expect(text()).not.toContain("We saved your answers");
    expect(input().value).toBe("");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a copy saved for a different version of the form", () => {
    localStorage.setItem(KEY, saved({ versionUpdatedAt: "2026-09-01T00:00:00.000Z" }));
    render();
    expect(input().value).toBe("");
    expect(text()).not.toContain("We saved your answers");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a copy older than 30 days", () => {
    localStorage.setItem(KEY, saved({ savedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 }));
    render();
    expect(input().value).toBe("");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("clears storage on a successful submit", async () => {
    localStorage.setItem(KEY, saved());
    render();
    await submit();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps storage when the submit fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    localStorage.setItem(KEY, saved());
    render();
    await submit();
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it("a pending debounced save does not rewrite storage after submit", async () => {
    render();
    type("Ada");
    await submit();
    flush(2000);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("a pending debounced save is cancelled on unmount", () => {
    render();
    type("Ada");
    act(() => root.unmount());
    root = createRoot(container);
    flush(2000);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does not throw when storage throws on read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render();
    expect(input().value).toBe("");
    expect(text()).not.toContain("We saved your answers");
  });

  it("does not throw when storage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    render();
    type("Ada");
    expect(() => flush(1000)).not.toThrow();
    expect(input().value).toBe("Ada");
  });

  it("does not show one person's progress to another on the same browser", () => {
    localStorage.setItem(KEY, saved());
    render({ userId: "u2" });
    expect(input().value).toBe("");
    expect(text()).not.toContain("We saved your answers");
    act(() => root.unmount());
    root = createRoot(container);
    render({ userId: null });
    expect(input().value).toBe("");
  });

  it("keeps signed-out progress under the anon key", () => {
    render({ userId: null });
    type("Ada");
    flush(500);
    expect(localStorage.getItem(progressKey("tok", "v1", null))).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is not active in preview", () => {
    localStorage.setItem(KEY, saved());
    render({ preview: true });
    expect(input().value).toBe("");
    type("Grace");
    flush(1000);
    expect(JSON.parse(localStorage.getItem(KEY)!).answers).toEqual({ name: "Ada" });
    expect(text()).not.toContain("We saved your answers");
  });

  it("is not active when editing a response", () => {
    localStorage.setItem(KEY, saved());
    render({ editing: { answers: { name: "Grace" } } });
    expect(input().value).toBe("Grace");
    type("Grace Hopper");
    flush(1000);
    expect(JSON.parse(localStorage.getItem(KEY)!).answers).toEqual({ name: "Ada" });
    expect(text()).not.toContain("We saved your answers");
  });

  it("does nothing when the flag is off", () => {
    localStorage.setItem(KEY, saved());
    render({ saveProgress: false });
    expect(input().value).toBe("");
    type("Grace");
    flush(1000);
    expect(JSON.parse(localStorage.getItem(KEY)!).answers).toEqual({ name: "Ada" });
    expect(text()).not.toContain("We saved your answers");
  });
});
