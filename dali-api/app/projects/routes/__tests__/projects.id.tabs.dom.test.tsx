// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";

vi.mock("~/lib/db.server");
vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useActionData: () => undefined,
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("../../lib/project-detail.server", () => ({ loadProjectDetail: vi.fn() }));
vi.mock("../../lib/project-detail-actions.server", () => ({ runProjectDetailAction: vi.fn() }));
vi.mock("~/components/collab/PresenceBar", () => ({ PresenceBar: () => null }));
vi.mock("~/components/collab/PresenceProvider", () => ({
  PresenceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../components/ProjectViewSwitch", () => ({ ProjectViewSwitch: () => null }));
vi.mock("../../components/TaskBoard", () => ({ TaskBoard: () => <div data-testid="board" /> }));
vi.mock("~/mentorship/components/ProjectMentorshipTab", () => ({
  ProjectMentorshipTab: () => <div data-testid="mentorship" />,
}));
vi.mock("~/components/drive/DriveBrowser", () => ({ DriveBrowser: () => null }));
vi.mock("~/projects/components/detail/ProjectHeader", () => ({
  ProjectHeader: () => <header data-testid="header">Atlas</header>,
}));
vi.mock("~/projects/components/detail/ProjectSettings", () => ({
  ScopeTab: () => <div data-testid="settings-view" />,
  SaveAsTemplateSection: () => null,
  DeleteProjectSection: () => null,
}));
vi.mock("~/projects/components/detail/OverviewTab", () => ({
  OverviewTab: () => <div data-testid="details" />,
}));
vi.mock("~/projects/components/detail/ProjectDriveTab", () => ({
  ProjectDriveTab: () => <div data-testid="drive" />,
}));
vi.mock("~/projects/components/detail/PlanningTab", () => ({
  PlanningTab: () => <div data-testid="planning" />,
}));

import { renderDom, click } from "~/test-utils/render";
import ProjectDetail from "../projects.$id";

function loaderData(over: Record<string, unknown> = {}) {
  return {
    project: { id: "p1", name: "Atlas", partners: [] },
    teams: [],
    boardOptions: { epics: [], members: [], terms: [], currentTermId: null },
    tasks: [],
    canEdit: true,
    canViewScope: true,
    canViewMentorshipTab: true,
    collabToken: null,
    ...over,
  };
}

function mount(search: string, over: Record<string, unknown> = {}) {
  const Page = ProjectDetail as unknown as (p: { loaderData: unknown }) => ReactNode;
  return renderDom(
    <MemoryRouter initialEntries={[`/projects/p1${search}`]}>
      <Page loaderData={loaderData(over)} />
    </MemoryRouter>,
  );
}

const tabs = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="tab"]')];
const selected = (c: HTMLElement) =>
  tabs(c)
    .filter((t) => t.getAttribute("aria-selected") === "true")
    .map((t) => t.textContent);

describe("project page tabs", () => {
  it("keeps the same header node when the tab changes", () => {
    const { container } = mount("");
    const header = container.querySelector('[data-testid="header"]');
    expect(header).not.toBeNull();
    click(tabs(container).find((t) => t.textContent === "Drive")!);
    expect(container.querySelector('[data-testid="drive"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="header"]')).toBe(header);
    click(tabs(container).find((t) => t.textContent === "Project details")!);
    expect(container.querySelector('[data-testid="header"]')).toBe(header);
  });

  it("opens on Progress with no param", () => {
    const { container } = mount("");
    expect(selected(container)).toEqual(["Progress"]);
    expect(container.querySelector('[data-testid="planning"]')).not.toBeNull();
  });

  it.each([
    ["?tab=overview", "Project details"],
    ["?tab=details", "Project details"],
    ["?tab=board", "Progress"],
    ["?tab=drive", "Drive"],
    ["?tab=mentorship", "Mentorship"],
    ["?tab=nonsense", "Progress"],
  ])("resolves %s to %s", (search, label) => {
    const { container } = mount(search);
    expect(selected(container)).toEqual([label]);
  });

  it("falls back to Progress for a mentorship link when the viewer cannot see it", () => {
    const { container } = mount("?tab=mentorship", { canViewMentorshipTab: false });
    expect(selected(container)).toEqual(["Progress"]);
    expect(tabs(container).map((t) => t.textContent)).not.toContain("Mentorship");
    expect(container.querySelector('[data-testid="mentorship"]')).toBeNull();
  });

  it("shows settings with no tab selected for ?tab=settings", () => {
    const { container } = mount("?tab=settings");
    expect(selected(container)).toEqual([]);
    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="planning"]')).toBeNull();
    const gear = container.querySelector<HTMLElement>('button[aria-label="Settings"]')!;
    expect(gear.getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the gear outside the tablist, and opens settings from it", () => {
    const { container } = mount("");
    const gear = container.querySelector<HTMLElement>('button[aria-label="Settings"]')!;
    expect(gear.closest('[role="tablist"]')).toBeNull();
    click(gear);
    expect(container.querySelector('[data-testid="settings-view"]')).not.toBeNull();
    expect(selected(container)).toEqual([]);
    click(tabs(container).find((t) => t.textContent === "Drive")!);
    expect(container.querySelector('[data-testid="settings-view"]')).toBeNull();
    expect(selected(container)).toEqual(["Drive"]);
  });

  it("hides the gear and ignores ?tab=settings for viewers who cannot see settings", () => {
    const { container } = mount("?tab=settings", { canViewScope: false });
    expect(container.querySelector('button[aria-label="Settings"]')).toBeNull();
    expect(container.querySelector('[data-testid="settings-view"]')).toBeNull();
    expect(selected(container)).toEqual(["Progress"]);
  });

  it("offers New task on Progress only, and only to editors", () => {
    const { container } = mount("");
    const has = () => [...container.querySelectorAll("button")].some((b) => b.textContent === "New task");
    expect(has()).toBe(true);
    click(tabs(container).find((t) => t.textContent === "Drive")!);
    expect(has()).toBe(false);
    const readOnly = mount("", { canEdit: false });
    expect([...readOnly.container.querySelectorAll("button")].some((b) => b.textContent === "New task")).toBe(false);
  });
});
