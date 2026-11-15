// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useSubmit: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("~/projects/components/ProjectImageBanner", () => ({ ProjectImageBanner: () => null }));
vi.mock("~/projects/components/ProjectIconPicker", () => ({
  ProjectIconPicker: () => <button type="button">icon</button>,
}));

import { renderDom } from "~/test-utils/render";
import { ProjectHeader } from "./ProjectHeader";
import type { LoaderData } from "./types";

const project = {
  id: "p1",
  name: "Atlas",
  status: "Active",
  iconEmoji: null,
  imageUrlResolved: null,
  terms: [{ code: "26F" }],
  termCount: 1,
  actualTermCount: 1,
  domains: [],
  derivedDomains: [],
  maintenancePlan: null,
} as unknown as LoaderData["project"];

describe("ProjectHeader", () => {
  it("shows the project name and term chips", () => {
    const { container } = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit={false} />);
    expect(container.textContent).toContain("Atlas");
    expect(container.textContent).toContain("26F");
  });

  it("only offers rename to editors", () => {
    const readOnly = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit={false} />);
    const editable = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit />);
    const count = (el: HTMLElement) => el.querySelectorAll("button, input, [role=button]").length;
    expect(count(editable.container)).toBeGreaterThan(count(readOnly.container));
  });

  it("keeps the current header until the band is asked for", () => {
    const { container } = renderDom(<ProjectHeader project={project} partnerNames={["Outing Club"]} canEdit={false} />);
    expect(container.querySelector('[data-testid="project-band"]')).toBeNull();
  });

  it("renders the band with title, partner, terms and the team", () => {
    const { container } = renderDom(
      <ProjectHeader
        project={project}
        partnerNames={["Outing Club"]}
        canEdit={false}
        band
        people={[{ userId: "u1", name: "Ada Lovelace", photoUrl: null }]}
      />,
    );
    const band = container.querySelector('[data-testid="project-band"]')!;
    expect(band.querySelector("h1")!.textContent).toBe("Atlas");
    expect(band.textContent).toContain("Outing Club · 26F");
    expect(band.textContent).toContain("AL");
  });
});
