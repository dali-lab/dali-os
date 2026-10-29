// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useNavigate: () => vi.fn(),
}));
vi.mock("~/components/doc", () => ({ DocEditor: () => null }));

import { FeatureFlagsProvider } from "~/components/FeatureFlags";
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

function mount({ blocks, questions = [question()] }: { blocks: boolean; questions?: Question[] }) {
  act(() => {
    root.render(
      createElement(
        FeatureFlagsProvider,
        { flags: { "form-blocks": blocks }, children: null },
        createElement(FormPreviewModal, {
          formId,
          formName: "Winter Demo Day RSVP",
          description: null,
          questions,
          onClose: () => {},
        }),
      ),
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

describe("FormPreviewModal with form-blocks on", () => {
  it("shows the form's own tile strip and the dali.os wordmark, like the fill page", () => {
    mount({ blocks: true });
    expect(strip()?.dataset.phase).toBe("idle");
    expect(tileCount()).toBe(stripPattern(formId).filter(Boolean).length);
    expect(text()).toContain("dali.os");
    expect(text()).not.toContain("DALI OS");
    expect(text()).toContain("Winter Demo Day RSVP");
  });

  it("folds into one block and shows the confirmation without submitting anything", async () => {
    mount({ blocks: true });
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(strip()?.dataset.phase).toBe("settled");
    expect(tileCount()).toBe(1);
    expect(text()).toContain("Thanks for submitting!");
  });

  it("enforces required questions the way respondents will see it", async () => {
    mount({ blocks: true, questions: [question(true)] });
    await submit();
    expect(strip()?.dataset.phase).toBe("idle");
    expect(text()).toContain("\"Your name\" is required.");
  });
});

describe("FormPreviewModal with form-blocks off", () => {
  it("keeps the plain card with the D badge and no strip", async () => {
    mount({ blocks: false });
    expect(strip()).toBeNull();
    expect(text()).toContain("DALI OS");
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain("Submitted");
  });
});

it("says there are no questions yet for an empty form", () => {
  mount({ blocks: true, questions: [] });
  expect(strip()).toBeNull();
  expect(text()).toContain("No questions yet.");
});
