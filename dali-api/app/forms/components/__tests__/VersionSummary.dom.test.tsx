// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("~/components/ui/floating", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  Select: ({ options }: { options: { value: string; label: string }[] }) =>
    createElement("ul", { "aria-label": "slots" }, options.map((o) => createElement("li", { key: o.value }, o.label))),
}));
vi.mock("~/forms/components/FormTracker", () => ({
  FormTracker: () => createElement("div", { "data-testid": "tracker" }),
}));

import { VersionSummary } from "~/forms/components/VersionSummary";

let container: HTMLDivElement;
let root: Root;

const base = { answered: 12, skipped: 4 };
const data = (questions: unknown[], over: Record<string, unknown> = {}) =>
  ({ versionId: "v1", slotOptions: [], summary: { total: 16, questions }, ...over }) as never;

function Where() {
  return createElement("output", null, useLocation().search);
}

async function mount(d: unknown, entry = "/forms/edit/f1?view=results&version=2", tracker: unknown = null) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const router = createMemoryRouter(
    [
      {
        path: "/forms/edit/f1",
        element: createElement(
          "div",
          null,
          createElement(VersionSummary, { formId: "f1", versionNumber: 2, data: d as never, tracker: tracker as never }),
          createElement(Where),
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  await act(async () => root.render(createElement(RouterProvider, { router })));
}

const click = (el: Element | null | undefined) =>
  act(async () => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text));

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("VersionSummary", () => {
  it("says No responses yet. for an empty version", async () => {
    await mount(data([], { summary: { total: 0, questions: [] } }));
    expect(container.textContent).toContain("No responses yet.");
  });

  it("shows the question number, label and answered line", async () => {
    await mount(data([{ kind: "choice", key: "a", number: 2, label: "Pick one", ...base, bars: [] }]));
    expect(container.textContent).toContain("Q2");
    expect(container.textContent).toContain("Pick one");
    expect(container.textContent).toContain("12 answered, 4 skipped");
  });

  it("shows a bar with count and percent for each option, and Other muted", async () => {
    await mount(
      data([
        {
          kind: "choice",
          key: "a",
          number: 1,
          label: "Pick",
          ...base,
          bars: [
            { label: "Yes", count: 9, percent: 75 },
            { label: "No", count: 0, percent: 0 },
            { label: "Other", count: 3, percent: 25, other: true },
          ],
        },
      ]),
    );
    expect(container.textContent).toContain("Yes");
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("No");
    expect(container.textContent).toContain("Other");
    const fills = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(fills.map((f) => f.style.width)).toEqual(["100%", "0%", "33.33333333333333%"]);
    expect(fills[2].className).toContain("bg-os-grey/30");
    expect(fills[0].className).toContain("bg-os-accent/30");
  });

  it("shows one row per skill with the average out of 5", async () => {
    await mount(
      data([
        {
          kind: "skills",
          key: "s",
          number: 1,
          label: "Skills",
          ...base,
          skills: [
            { skill: "React", rated: 3, average: 3.8, distribution: [0, 0, 1, 0, 1, 1] },
            { skill: "Figma", rated: 0, average: null, distribution: [0, 0, 0, 0, 0, 0] },
          ],
        },
      ]),
    );
    expect(container.textContent).toContain("React");
    expect(container.textContent).toContain("3.8 of 5");
    expect(container.textContent).toContain("Figma");
    expect(container.textContent).toContain("Not rated");
  });

  it("shows the scale average large above five bars", async () => {
    await mount(
      data([
        {
          kind: "scale",
          key: "n",
          number: 1,
          label: "Rate it",
          ...base,
          average: 3.5,
          bars: [1, 2, 3, 4, 5].map((n) => ({ label: String(n), count: n, percent: n })),
        },
      ]),
    );
    expect(container.textContent).toContain("3.5");
    expect(container.querySelectorAll("[data-bar]")).toHaveLength(5);
  });

  it("shows number stats", async () => {
    await mount(
      data([{ kind: "number", key: "n", number: 1, label: "Hours", ...base, count: 10, average: 4.5, lowest: 1, highest: 9 }]),
    );
    for (const text of ["Count", "10", "Average", "4.5", "Lowest", "Highest", "9"]) {
      expect(container.textContent).toContain(text);
    }
  });

  it("links text questions to the Responses table", async () => {
    await mount(data([{ kind: "text", key: "t", number: 1, label: "Why", ...base }]), "/forms/edit/f1?view=results&version=2&slot=Tue");
    expect(button("Read 12 answers")).toBeTruthy();
    await click(button("Read 12 answers"));
    const search = container.querySelector("output")!.textContent!;
    expect(search).toContain("show=responses");
    expect(search).toContain("view=results");
    expect(search).toContain("slot=Tue");
  });

  it("switches to Responses from the toggle and offers CSV export", async () => {
    await mount(data([{ kind: "text", key: "t", number: 1, label: "Why", ...base }]));
    expect(container.querySelector('a[aria-label="Export CSV"]')!.getAttribute("href")).toBe(
      "/forms/responses/f1/export.csv?version=2",
    );
    expect(button("Summary")!.getAttribute("aria-pressed")).toBe("true");
    await click(button("Responses"));
    expect(container.querySelector("output")!.textContent).toContain("show=responses");
  });

  it("has no search box, offers the slot filter, and keeps the tracker above the rows", async () => {
    await mount(
      data([{ kind: "text", key: "t", number: 1, label: "Why", ...base }], { slotOptions: ["referrals", "Tue 3pm"] }),
      undefined,
      { expected: 5, responded: 3 },
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("referrals");
    const tracker = container.querySelector('[data-testid="tracker"]')!;
    const section = container.querySelector("section")!;
    expect(tracker.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
