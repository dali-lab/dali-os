// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { PANE_BLEED_TOP_CLASS, PANE_GUTTER_CLASS } from "~/components/shell/pane-gutter";

vi.mock("react-router", () => ({ useSubmit: () => vi.fn() }));
vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/components/cover/GeneratedArt", () => ({ GeneratedArt: () => <div /> }));
vi.mock("~/projects/components/ProjectCoverModal", () => ({ ProjectCoverModal: () => null }));
vi.mock("~/projects/components/ProjectImageBanner", () => ({ ProjectImageBanner: () => <div /> }));
vi.mock("~/projects/components/ProjectIconPicker", () => ({ ProjectIconPicker: () => null }));
vi.mock("~/components/ProjectIcon", () => ({ ProjectIcon: () => null }));

import { renderDom } from "~/test-utils/render";
import { ProjectHeader } from "../ProjectHeader";

const project = {
  id: "p1",
  name: "Atlas",
  status: "Active",
  iconEmoji: null,
  imageUrl: null,
  imageUrlResolved: null,
  terms: [{ code: "26F" }],
  domains: [],
  derivedDomains: [],
  termCount: 1,
  actualTermCount: 1,
  maintenancePlan: null,
} as never;

const mount = (band: boolean) =>
  renderDom(
    <ProjectHeader project={project} partnerNames={[]} canEdit={false} band={band} />,
  );

describe("ProjectHeader band", () => {
  it("runs edge to edge with square corners under the top bar", () => {
    const header = mount(true).container.querySelector<HTMLElement>('[data-testid="project-band"]')!;
    for (const c of PANE_BLEED_TOP_CLASS.split(" ")) expect(header.classList.contains(c)).toBe(true);
    expect(header.className).not.toContain("rounded");
    expect(header.className).toContain("p-6");
  });

  it("cancels exactly the gutter the routed page adds", () => {
    const gutter = PANE_GUTTER_CLASS.split(" ").filter((c) => /(^|:)p[xt]-/.test(c));
    expect(PANE_BLEED_TOP_CLASS.split(" ").sort()).toEqual(gutter.map((c) => c.replace(/(^|:)p([xt])-/, "$1-m$2-")).sort());
  });

  it("leaves the flag-off header without a band", () => {
    const { container } = mount(false);
    expect(container.querySelector('[data-testid="project-band"]')).toBeNull();
    expect(container.querySelector("header")!.className).not.toContain("-mx-");
  });
});
