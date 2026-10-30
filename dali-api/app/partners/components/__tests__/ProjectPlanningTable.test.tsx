import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { ProjectPlanningTable } from "../ProjectPlanningTable";
import type { PlanningProjectModel, PlanningProjectRow } from "../../lib/planning-gap";

function row(over: Partial<PlanningProjectRow> = {}): PlanningProjectRow {
  return {
    key: "project:p1",
    kind: "project",
    refId: "p1",
    name: "Gallery kiosk",
    source: "renewing",
    state: "Continuing",
    spotsByDomain: { eng: 3, des: 1 },
    spots: 4,
    counted: true,
    domains: [
      { domainId: "eng", name: "Engineering", count: 3 },
      { domainId: "des", name: "Design", count: 1 },
    ],
    ...over,
  };
}

function render(model: Partial<PlanningProjectModel>) {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ProjectPlanningTable, {
        termCode: "27W",
        model: { renewing: [], fresh: [], totals: { renewing: 0, fresh: 0, spots: 0 }, ...model },
      }),
    ),
  );
}

describe("ProjectPlanningTable", () => {
  it("shows a row's state, spots and domains", () => {
    const html = render({ renewing: [row()], totals: { renewing: 4, fresh: 0, spots: 4 } });
    expect(html).toContain("Gallery kiosk");
    expect(html).toContain("Renewal · Continuing");
    expect(html).toContain("Engineering 3, Design 1");
    expect(html).toContain("4 · 4 renewing, 0 new");
  });

  it("says when a row has no spots set", () => {
    expect(render({ renewing: [row({ spots: 0, domains: [], spotsByDomain: {} })] })).toContain("No spots set");
  });

  it("labels each group with its count and skips an empty one", () => {
    const html = render({ fresh: [row({ key: "application:a", source: "new", state: "Interview" })] });
    expect(html).toContain("New · 1");
    expect(html).not.toContain("Renewing");
  });

  it("links applications to the board and projects to renewals", () => {
    const html = render({
      renewing: [row()],
      fresh: [row({ key: "application:a", kind: "application", refId: "a", source: "new", state: "Deciding" })],
    });
    expect(html).toContain('href="/core/partners/renewals"');
    expect(html).toContain('href="/core/partners?application=a"');
  });

  it("dims rows left out of the totals", () => {
    expect(render({ renewing: [row({ counted: false })] })).toContain("opacity-45");
    expect(render({ renewing: [row()] })).not.toContain("opacity-45");
  });

  it("names the term when there is nothing to show", () => {
    expect(render({})).toContain("No projects or applications for 27W yet.");
  });
});
