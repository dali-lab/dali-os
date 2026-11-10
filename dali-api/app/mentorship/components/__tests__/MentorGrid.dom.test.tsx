// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { MentorGrid } from "../MentorGrid";
import { emptyDomainTermForms, type TermForms } from "../../lib/term-forms";
import type { GridMenteeRow, GridMentorGroup } from "../../lib/mentor-grid.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: string, firstName: string) => ({ id, firstName, lastName: "", photoUrl: null });
const row = (menteeId: string, name: string, domainId: string, domainCode: string): GridMenteeRow => ({
  key: menteeId,
  pairId: `pair-${menteeId}`,
  manual: false,
  mentee: person(menteeId, name),
  menteeId,
  projectId: "p1",
  domainId,
  projectName: "Proj",
  domainCode,
  cells: [],
});

function forms(entries: Record<string, (d: ReturnType<typeof emptyDomainTermForms>) => void>): TermForms {
  return Object.fromEntries(
    Object.entries(entries).map(([domainId, fill]) => {
      const d = emptyDomainTermForms();
      fill(d);
      return [domainId, d];
    }),
  );
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(group: GridMentorGroup, termForms: TermForms, weeks: number[] = []) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(MentorGrid, {
          group,
          weeks,
          currentWeek: null,
          termId: "t1",
          highlightMissing: false,
          termForms,
        }),
    },
  ]);
  act(() => root.render(createElement(Stub)));
}

describe("MentorGrid cards", () => {
  const sub = { submittedAt: "2026-10-14T00:00:00Z", rows: [{ key: "k", label: "Q", value: "answer" }] };
  const linked = (fill: (d: ReturnType<typeof emptyDomainTermForms>) => void) =>
    forms({
      dev: (d) => {
        d.mentor.form = { id: "f1", name: "Dev mentor" };
        d.mentee.form = { id: "f2", name: "Dev mentee" };
        fill(d);
      },
    });
  const twoMentees = () => ({
    mentor: person("m1", "Mo"),
    rows: [row("a", "Ada", "dev", "DEV"), row("b", "Zed", "dev", "DEV")],
  });
  const week5 = (menteeId: string): GridMenteeRow => ({
    ...row(menteeId, menteeId === "a" ? "Ada" : "Zed", "dev", "DEV"),
    cells: [5].map((week) => ({ week, weekOfIso: "2026-10-05T00:00:00Z", state: "future" as const, noteId: null, vibe: null, canCreate: false })),
  });
  const formPills = () =>
    [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label")?.startsWith("Open Week 5 forms"));

  it("collapses and re-expands a mentor group, open by default", () => {
    render(twoMentees(), forms({}));
    expect(container.textContent).toContain("Ada");
    const toggle = container.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle.click());
    expect(container.textContent).not.toContain("Ada");
    act(() => toggle.click());
    expect(container.textContent).toContain("Ada");
  });

  it("shows one check-in bubble per mentee, only when a form is linked", () => {
    const group = { mentor: person("m1", "Mo"), rows: [week5("a"), week5("b")] };
    render(group, linked(() => {}), [5]);
    expect(formPills()).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(container);
    render(group, forms({ design: (d) => (d.mentee.form = { id: "f", name: "x" }) }), [5]);
    expect(formPills()).toHaveLength(0);
  });

  it("opens the shared mentor form with that mentee's own, side by side, with statuses", () => {
    const group = { mentor: person("m1", "Mo"), rows: [week5("a"), week5("b")] };
    render(group, linked((d) => {
      d.mentor.responses.m1 = sub;
      d.mentee.responses.a = sub;
    }));
    act(() => formPills()[1].click());
    expect(document.body.querySelectorAll('section[aria-label="Mentor Form"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('section[aria-label="Mentee Form"]')).toHaveLength(1);
    const text = document.body.textContent!;
    expect(text).toContain("Submitted"); // the mentor
    expect(text).toContain("Not submitted"); // Zed
  });

  it("shows a response with no question label as just the answer", () => {
    const group = { mentor: person("m1", "Mo"), rows: [week5("a")] };
    render(group, linked((d) => {
      d.mentee.responses.a = { submittedAt: "2026-10-14T00:00:00Z", rows: [{ key: "r", label: "", value: "free text" }] };
    }));
    act(() => formPills()[0].click());
    expect(document.body.textContent).toContain("free text");
    expect(document.body.querySelectorAll("dt")).toHaveLength(0);
  });
});
