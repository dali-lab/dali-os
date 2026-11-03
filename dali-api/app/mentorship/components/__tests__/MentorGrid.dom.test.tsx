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

describe("MentorGrid week 5 form card", () => {
  const sub = { submittedAt: "2026-10-14T00:00:00Z", rows: [{ key: "k", label: "Q", value: "answer" }] };

  it("is one card per mentor section listing the mentor and every mentee with their own status", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV"), row("b", "Zed", "dev", "DEV")] };
    render(
      group,
      forms({
        dev: (d) => {
          d.mentee.form = { id: "f1", name: "Dev mentee" };
          d.mentor.form = { id: "f2", name: "Dev mentor" };
          d.mentee.responses.a = sub;
        },
      }),
    );
    expect(container.textContent!.match(/Week 5 Form/g)).toHaveLength(1);
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain("not submitted"); // mentor
    expect(items[1]).toContain("Mentee, submitted"); // Ada
    expect(items[2]).toContain("not submitted"); // Zed
  });

  it("hides the card when none of the mentees' domains link a form", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV")] };
    render(group, forms({ design: (d) => (d.mentee.form = { id: "f1", name: "Design mentee" }) }));
    expect(container.textContent).not.toContain("Week 5 Form");
  });

  it("opens every form in one modal from the single action", () => {
    const group = { mentor: person("m1", "Mo"), rows: [row("a", "Ada", "dev", "DEV"), row("b", "Zed", "dev", "DEV")] };
    render(
      group,
      forms({
        dev: (d) => {
          d.mentor.form = { id: "f1", name: "Dev mentor" };
          d.mentee.form = { id: "f2", name: "Dev mentee" };
          d.mentor.responses.m1 = sub;
          d.mentee.responses.a = sub;
          d.mentee.responses.b = sub;
        },
      }),
    );
    const btn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("View all"))!;
    act(() => btn.click());
    expect(document.body.querySelectorAll('section[aria-label="Mentee Form"]')).toHaveLength(2);
    expect(document.body.querySelectorAll('section[aria-label="Mentor Form"]')).toHaveLength(1);
  });
});
