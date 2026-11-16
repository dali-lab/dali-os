// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useSubmit: () => vi.fn(),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("~/projects/components/ProjectImageBanner", () => ({ ProjectImageBanner: () => <div data-testid="legacy-banner" /> }));
vi.mock("~/projects/components/ProjectCoverModal", () => ({ ProjectCoverModal: () => <div data-testid="cover-modal" /> }));
vi.mock("~/projects/components/ProjectIconPicker", () => ({
  ProjectIconPicker: () => <button type="button">icon</button>,
}));

import { renderDom, click } from "~/test-utils/render";
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

  it("keeps the legacy banner and no cover button with the flag off", () => {
    const { container } = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit />);
    expect(container.querySelector('[data-testid="legacy-banner"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Change cover");
  });

  it("paints the band from tokens and names the roles", () => {
    const withRoles = { ...project, domains: [{ id: "d1", name: "Design" }] } as unknown as LoaderData["project"];
    const { container } = renderDom(<ProjectHeader project={withRoles} partnerNames={[]} canEdit={false} band />);
    const band = container.querySelector('[data-testid="project-band"]') as HTMLElement;
    expect(band.className).toContain("bg-os-band");
    expect(band.className).toContain("text-os-on-band");
    expect(band.style.backgroundColor).toBe("");
    const chip = Array.from(band.querySelectorAll("span")).find((n) => n.textContent === "Design")!;
    expect(chip.className).toContain("border-os-band-line");
    expect(chip.className).toContain("bg-os-band-chip");
    expect(band.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("falls back to generated art with no cover", () => {
    const { container } = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit={false} band />);
    expect(container.querySelector('[data-testid="generated-art"]')).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows an uploaded image as before", () => {
    const withImage = { ...project, imageUrl: "uploads/a.webp", imageUrlResolved: "https://img.example/a.webp" } as unknown as LoaderData["project"];
    const { container } = renderDom(<ProjectHeader project={withImage} partnerNames={[]} canEdit={false} band />);
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://img.example/a.webp");
    expect(container.querySelector('[data-testid="generated-art"]')).toBeNull();
  });

  it("draws a pattern cover with its card color", () => {
    const withPattern = { ...project, imageUrl: "pattern:poster?c=plum", imageUrlResolved: null } as unknown as LoaderData["project"];
    const { container } = renderDom(<ProjectHeader project={withPattern} partnerNames={[]} canEdit={false} band />);
    const band = container.querySelector('[data-testid="project-band"]') as HTMLElement;
    expect(band.style.backgroundColor).toBe("var(--art-plum)");
    expect(band.querySelector("svg")).not.toBeNull();
    expect(container.querySelector('[data-testid="generated-art"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the default card color for a bare pattern cover", () => {
    const withPattern = { ...project, imageUrl: "pattern:poster" } as unknown as LoaderData["project"];
    const { container } = renderDom(<ProjectHeader project={withPattern} partnerNames={[]} canEdit={false} band />);
    expect((container.querySelector('[data-testid="project-band"]') as HTMLElement).style.backgroundColor).toBe("var(--art-ink)");
  });

  it("treats a malformed pattern as no cover", () => {
    const bad = { ...project, imageUrl: "pattern:nope" } as unknown as LoaderData["project"];
    const { container } = renderDom(<ProjectHeader project={bad} partnerNames={[]} canEdit={false} band />);
    expect(container.querySelector('[data-testid="generated-art"]')).not.toBeNull();
  });

  it("offers the cover picker only to editors", () => {
    const viewer = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit={false} band />);
    expect(viewer.container.textContent).not.toContain("Change cover");
    const editor = renderDom(<ProjectHeader project={project} partnerNames={[]} canEdit band />);
    expect(editor.container.querySelector('[data-testid="cover-modal"]')).toBeNull();
    const btn = Array.from(editor.container.querySelectorAll("button")).find((b) => b.textContent?.includes("Change cover"))!;
    click(btn);
    expect(editor.container.querySelector('[data-testid="cover-modal"]')).not.toBeNull();
  });
});
