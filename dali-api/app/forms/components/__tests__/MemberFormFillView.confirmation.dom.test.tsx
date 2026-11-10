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
    createElement("div", { "data-doc": true }, JSON.stringify(initialContent ?? null)),
}));

import { MemberFormFillView } from "~/forms/components/MemberFormFillView";
import type { Question } from "~/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const questions: Question[] = [
  { key: "name", type: "text", required: false, data: { label: "Your name" } },
];
const MESSAGE = [{ type: "paragraph", content: [{ type: "text", text: "Ask in the staffing channel" }] }];
const EMPTY = [{ type: "paragraph", content: [] }];
const DEFAULT_COPY = "has been recorded.";

let container: HTMLDivElement;
let root: Root;

const text = () => container.textContent ?? "";

async function fill(props: {
  confirmationMessage?: unknown;
  tileSeed?: string | null;
  doneContent?: React.ReactNode;
  editing?: boolean;
}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }),
  );
  act(() => {
    root.render(
      createElement(MemberFormFillView, {
        data: {
          name: "Intake",
          description: null,
          confirmationMessage: props.confirmationMessage,
          versionId: "v1",
          versionUpdatedAt: "2026-10-01T00:00:00.000Z",
          questions,
          token: "tok",
        },
        tileSeed: props.tileSeed ?? null,
        doneContent: props.doneContent,
        editing: props.editing,
      } as never),
    );
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe.each([
  ["without tiles", null],
  ["with tiles", "cm_form_intake"],
])("confirmation message %s", (_name, tileSeed) => {
  it("replaces the default text under the heading", async () => {
    await fill({ confirmationMessage: MESSAGE, tileSeed });
    expect(text()).toContain("Ask in the staffing channel");
    expect(text()).not.toContain(DEFAULT_COPY);
  });

  it("keeps the default text when the message is empty or missing", async () => {
    await fill({ confirmationMessage: EMPTY, tileSeed });
    expect(text()).toContain(DEFAULT_COPY);
    await act(async () => root.unmount());
    root = createRoot(container);
    await fill({ confirmationMessage: null, tileSeed });
    expect(text()).toContain(DEFAULT_COPY);
  });

  it("lets doneContent win", async () => {
    await fill({ confirmationMessage: MESSAGE, tileSeed, doneContent: createElement("p", null, "Custom done") });
    expect(text()).toContain("Custom done");
    expect(text()).not.toContain("Ask in the staffing channel");
  });
});

describe("confirmation message on an edit", () => {
  it("is not shown after a response edit", async () => {
    await fill({ confirmationMessage: MESSAGE, editing: true });
    expect(text()).toContain("Response updated");
    expect(text()).not.toContain("Ask in the staffing channel");
  });
});
