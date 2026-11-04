// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/doc", () => ({
  DocEditor: ({ initialContent }: { initialContent?: unknown }) =>
    createElement("div", null, JSON.stringify(initialContent ?? null)),
}));

import { FormPreviewModal } from "~/forms/components/FormPreviewModal";
import { stripPattern } from "~/forms/lib/tile-strip";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const formId = "cm_form_rsvp";
const question = (required = false): Question => ({
  key: "name",
  type: "text",
  required,
  data: { label: "Your name" },
});

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const text = () => document.body.textContent ?? "";
const strip = () => document.body.querySelector<HTMLElement>("[data-phase]");
const tileCount = () => strip()?.querySelectorAll("[data-tile]").length ?? 0;
const submit = () =>
  act(async () => {
    document.body.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

function mount({
  questions = [question()],
  iconEmoji = null,
  confirmationMessage,
}: { questions?: Question[]; iconEmoji?: string | null; confirmationMessage?: unknown } = {}) {
  act(() => {
    root.render(
      createElement(FormPreviewModal, {
        formId,
        formName: "Winter Demo Day RSVP",
        iconEmoji,
        description: null,
        confirmationMessage,
        questions,
        onClose: () => {},
      }),
    );
  });
}

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

describe("FormPreviewModal", () => {
  it("shows the form's own tile strip and the dali.os wordmark, like the fill page", () => {
    mount();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(tileCount()).toBe(stripPattern(formId).filter(Boolean).length);
    expect(text()).toContain("dali.os");
    expect(text()).not.toContain("DALI OS");
    expect(text()).toContain("Winter Demo Day RSVP");
  });

  it("folds into one block and shows the confirmation without submitting anything", async () => {
    mount();
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(strip()?.dataset.phase).toBe("settled");
    expect(tileCount()).toBe(1);
    expect(text()).toContain("Thanks for submitting!");
  });

  it("enforces required questions the way respondents will see it", async () => {
    mount({ questions: [question(true)] });
    await submit();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(text()).toContain("\"Your name\" is required.");
  });
});

describe("FormPreviewModal icon", () => {
  it("shows the form's emoji beside its title", () => {
    mount({ iconEmoji: "📋" });
    expect(text()).toContain("📋");
  });
});

it("says there are no questions yet for an empty form", () => {
  mount({ questions: [] });
  expect(strip()).toBeNull();
  expect(text()).toContain("No questions yet.");
});

describe("FormPreviewModal confirmation message", () => {
  it("shows the saved confirmation message on the done screen", async () => {
    mount({
      confirmationMessage: [{ type: "paragraph", content: [{ type: "text", text: "See you at demo day" }] }],
    });
    await submit();
    expect(text()).toContain("See you at demo day");
    expect(text()).not.toContain("has been recorded.");
  });
});
