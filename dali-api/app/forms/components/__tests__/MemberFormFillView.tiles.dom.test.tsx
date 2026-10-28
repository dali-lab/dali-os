// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { MemberFormFillView, MemberFormShell } from "~/forms/components/MemberFormFillView";
import { stripPattern } from "~/forms/lib/tile-strip";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const question = (required: boolean): Question => ({
  key: "name",
  type: "text",
  required,
  data: { label: "Your name" },
});

const data = (required = false) => ({
  name: "Winter Demo Day RSVP",
  description: null,
  versionId: "v1",
  versionUpdatedAt: "2026-10-01T00:00:00.000Z",
  questions: [question(required)],
  token: "tok_1",
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const text = () => container.textContent ?? "";
const strip = () => container.querySelector<HTMLElement>("[data-phase]");
const tileCount = () => strip()?.querySelectorAll("[data-tile]").length ?? 0;
const submit = () =>
  act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

function mount(props: { tileSeed?: string | null; required?: boolean }) {
  act(() => {
    root.render(
      createElement(
        MemberFormShell,
        { flush: Boolean(props.tileSeed), children: null },
        createElement(MemberFormFillView, { data: data(props.required), tileSeed: props.tileSeed }),
      ),
    );
  });
}

const respond = (status: number, body: object) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("MemberFormFillView with a tile strip", () => {
  const seed = "cm_form_rsvp";
  const filled = stripPattern(seed).filter(Boolean).length;

  it("opens with the form's full strip and the text wordmark in place of the D badge", () => {
    mount({ tileSeed: seed });
    expect(strip()?.dataset.phase).toBe("idle");
    expect(tileCount()).toBe(filled);
    expect(text()).toContain("dali.os");
    expect(text()).not.toContain("DALI OS");
  });

  it("folds to one block and shows the confirmation once the response is saved", async () => {
    respond(200, {});
    mount({ tileSeed: seed });
    await submit();
    expect(strip()?.dataset.phase).toBe("settled");
    expect(tileCount()).toBe(1);
    expect(text()).toContain("Thanks for submitting!");
    expect(text()).toContain("Your response to “Winter Demo Day RSVP” has been recorded.");
    expect(container.querySelector("form")).toBeNull();
  });

  it("puts the strip and the form back with the error when the save fails", async () => {
    respond(400, { error: "This form is closed." });
    mount({ tileSeed: seed });
    await submit();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(tileCount()).toBe(filled);
    expect(container.querySelector("form")).not.toBeNull();
    expect(text()).toContain("This form is closed.");
  });

  it("puts the strip back when the network fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    mount({ tileSeed: seed });
    await submit();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(text()).toContain("Network error");
  });

  it("does not fold when a required answer is missing", async () => {
    mount({ tileSeed: seed, required: true });
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(text()).toContain("\"Your name\" is required.");
  });
});

describe("MemberFormFillView without a tile strip", () => {
  it("keeps the D badge and the plain Submitted screen", async () => {
    respond(200, {});
    mount({ tileSeed: null });
    expect(strip()).toBeNull();
    expect(text()).toContain("DALI OS");
    await submit();
    expect(text()).toContain("Submitted");
    expect(text()).toContain("has been recorded.");
  });
});

describe("MemberFormFillView tile strip with animations running", () => {
  type Call = { el: Element; frames: Keyframe[]; anim: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null } };
  let calls: Call[];
  const realAnimate = Element.prototype.animate;

  beforeEach(() => {
    calls = [];
    Element.prototype.animate = function (this: Element, frames: Keyframe[] | PropertyIndexedKeyframes | null) {
      const anim = { cancel: vi.fn(), onfinish: null as (() => void) | null, finished: Promise.resolve() };
      calls.push({ el: this, frames: frames as Keyframe[], anim });
      setTimeout(() => anim.onfinish?.(), 0);
      return anim as unknown as Animation;
    };
  });

  afterEach(() => {
    Element.prototype.animate = realAnimate;
  });

  const runAnimations = async () => {
    for (let i = 0; i < 200 && strip()?.dataset.phase !== "settled"; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };

  const isFormFade = (c: Call) => c.frames.length === 2 && c.frames[0].opacity === 1 && c.frames[1].opacity === 0;

  it("shows the confirmation on a fresh element, not the faded-out form", async () => {
    respond(200, {});
    mount({ tileSeed: "cm_form_rsvp" });
    await submit();
    await runAnimations();

    expect(strip()?.dataset.phase).toBe("settled");
    const fade = calls.find(isFormFade);
    expect(fade).toBeDefined();
    const heading = [...container.querySelectorAll("h1")].find((h) => h.textContent === "Thanks for submitting!");
    expect(heading).toBeDefined();
    expect(fade!.el.contains(heading!)).toBe(false);
    expect(fade!.anim.cancel).toHaveBeenCalled();
  });

  it("plays every fold before settling", async () => {
    respond(200, {});
    mount({ tileSeed: "cm_form_rsvp" });
    await submit();
    await runAnimations();
    const folds = calls.filter((c) => String(c.frames[0].transform ?? "").startsWith("rotate"));
    expect(folds).toHaveLength(8);
  });
});
