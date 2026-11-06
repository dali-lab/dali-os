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
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const org: Question = { key: "org", type: "text", required: true, data: { label: "Organization", prefill: "partnerOrg.name" } };
const notes: Question = { key: "notes", type: "text", required: false, data: { label: "Notes" } };

let container: HTMLDivElement;
let root: Root;

function render(extra: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      createElement(MemberFormFillView, {
        data: {
          name: "Plan",
          description: null,
          versionId: "v1",
          versionUpdatedAt: "2026-11-01T00:00:00.000Z",
          questions: [org, notes],
          token: "tok",
          prefill: { org: "Analytical Co" },
        },
        ...extra,
      } as never),
    );
  });
}

const input = (label: string) =>
  [...container.querySelectorAll("input")].find((i) => i.closest("div")?.textContent?.includes(label) || i.getAttribute("aria-label") === label) as HTMLInputElement;
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

describe("MemberFormFillView prefill", () => {
  it("starts with the prefilled answer in the field", () => {
    render();
    expect(input("Organization").value).toBe("Analytical Co");
    expect(input("Notes").value).toBe("");
  });

  it("submits the prefilled answer untouched", async () => {
    render();
    await submit();
    expect(posted().answers).toEqual({ org: "Analytical Co" });
  });

  it("lets the filler change it", async () => {
    render();
    const field = input("Organization");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(field, "Analytical Co (Boston)");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(posted().answers).toEqual({ org: "Analytical Co (Boston)" });
  });

  it("uses the stored answers, not the prefill, when editing a response", () => {
    render({ editing: { answers: { org: "Old Co" } } });
    expect(input("Organization").value).toBe("Old Co");
  });
});
