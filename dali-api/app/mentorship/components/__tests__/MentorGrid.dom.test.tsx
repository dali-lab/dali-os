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

function render(group: GridMentorGroup, termForms: TermForms) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () =>
        createElement(MentorGrid, {
          group,
          weeks: [],
          currentWeek: null,
          termId: "t1",
          highlightMissing: false,
          termForms,
        }),
    },
  ]);
  act(() => root.render(createElement(Stub)));
}

const cellFor = (name: string) =>
  [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!
    .lastElementChild!.textContent;

describe("MentorGrid week 5 forms", () => {
  it("shows each mentee the form linked to their own domain", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV"), row("b", "Bo", "design", "DES")] };
    render(
      group,
      forms({
        dev: (d) => {
          d.mentee.form = { id: "f1", name: "Dev mentee" };
          d.mentee.responses.a = { submittedAt: "2026-10-14T00:00:00Z", rows: [] };
        },
      }),
    );
    expect(container.textContent).toContain("Week 5 form");
    expect(cellFor("Ada")).toBe("Submitted");
    expect(cellFor("Bo")).toBe("");
  });

  it("hides the column when none of the mentees' domains link a form", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV")] };
    render(group, forms({ design: (d) => (d.mentee.form = { id: "f1", name: "Design mentee" }) }));
    expect(container.textContent).not.toContain("Week 5 form");
  });

  it("shows the mentor one status per domain they mentor in, labelled when there are several", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV"), row("b", "Bo", "design", "DES")] };
    render(
      group,
      forms({
        dev: (d) => {
          d.mentor.form = { id: "f1", name: "Dev mentor" };
          d.mentor.responses.m1 = { submittedAt: "2026-10-14T00:00:00Z", rows: [] };
        },
        design: (d) => (d.mentor.form = { id: "f2", name: "Design mentor" }),
      }),
    );
    const heading = container.querySelector("h2")!.textContent;
    expect(heading).toContain("DEVSubmitted");
    expect(heading).toContain("DESNot submitted");
  });

  it("leaves the domain label off when the mentor has one domain", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV")] };
    render(group, forms({ dev: (d) => (d.mentor.form = { id: "f1", name: "Dev mentor" }) }));
    const heading = container.querySelector("h2")!.textContent;
    expect(heading).toContain("Not submitted");
    expect(heading).not.toContain("DEV");
  });
});
