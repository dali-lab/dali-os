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
const KEY = progressKey("tok", "v1", "u1");

const returning: Question = {
  key: "returning",
  type: "radio",
  required: true,
  data: { label: "Returning next term?", options: ["Yes", "No"] },
};
const why: Question = {
  key: "why",
  type: "text",
  required: true,
  data: { label: "Why are you leaving?", showIf: { questionKey: "returning", op: "is", value: "No" } },
};
const pageBreak = { key: "pb", type: "pageBreak", required: false, data: { label: "" } } as unknown as Question;
const city: Question = { key: "city", type: "text", required: false, data: { label: "City" } };

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? "";

function render(questions: Question[], opts: { saveProgress?: boolean } = {}) {
  act(() => {
    root.render(
      createElement(MemberFormFillView, {
        data: { name: "Intake", description: null, versionId: "v1", versionUpdatedAt: V, questions, token: "tok" },
        saveProgress: opts.saveProgress ?? false,
        progressUserId: "u1",
      } as never),
    );
  });
}

const restoreWith = (answers: Record<string, string>) =>
  localStorage.setItem(KEY, JSON.stringify({ answers, pageIndex: 0, versionUpdatedAt: V, savedAt: Date.now() }));
const submit = () =>
  act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const posted = () => JSON.parse(((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit).body as string);

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MemberFormFillView with rules", () => {
  it("hides a conditional question until an earlier answer calls for it", () => {
    render([returning, why]);
    expect(text()).not.toContain("Why are you leaving?");
    act(() => {
      (container.querySelector('input[type="radio"][value="No"]') as HTMLInputElement).click();
    });
    expect(text()).toContain("Why are you leaving?");
    act(() => {
      (container.querySelector('input[type="radio"][value="Yes"]') as HTMLInputElement).click();
    });
    expect(text()).not.toContain("Why are you leaving?");
  });

  it("submits without a hidden required question and posts no hidden answer", async () => {
    restoreWith({ returning: "Yes", why: "stale" });
    render([returning, why], { saveProgress: true });
    await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(posted().answers).toEqual({ returning: "Yes" });
  });

  it("blocks submit on a shown required question", async () => {
    restoreWith({ returning: "No" });
    render([returning, why], { saveProgress: true });
    await submit();
    expect(fetch).not.toHaveBeenCalled();
    expect(text()).toContain('"Why are you leaving?" is required.');
  });

  it("drops a page that rules emptied from the step count", () => {
    restoreWith({ returning: "Yes" });
    render([returning, pageBreak, why, pageBreak, city], { saveProgress: true });
    expect(text()).toContain("Step 1 of 2");
  });

  it("counts the page once its rule shows it", () => {
    restoreWith({ returning: "No" });
    render([returning, pageBreak, why, pageBreak, city], { saveProgress: true });
    expect(text()).toContain("Step 1 of 3");
  });

  it("keeps a hidden answer in the saved copy", () => {
    vi.useFakeTimers();
    try {
      restoreWith({ returning: "Yes", why: "stale" });
      render([returning, why], { saveProgress: true });
      act(() => void vi.advanceTimersByTime(1000));
      expect(JSON.parse(localStorage.getItem(KEY)!).answers).toEqual({ returning: "Yes", why: "stale" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks formats on shown questions only", async () => {
    const mail: Question = {
      key: "mail",
      type: "email",
      required: false,
      data: { label: "Email", showIf: { questionKey: "returning", op: "is", value: "No" } },
    };
    restoreWith({ returning: "Yes", mail: "not an email" });
    render([returning, mail], { saveProgress: true });
    await submit();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(posted().answers).toEqual({ returning: "Yes" });
  });
});
