// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { renderDom, click } from "~/test-utils/render";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("../../components/PartnerSettingsModal", () => ({ PartnerSettingsModal: () => null }));
vi.mock("../../components/PlanningTable", () => ({ PlanningTable: () => null }));
vi.mock("../../components/ProjectPlanningTable", () => ({ ProjectPlanningTable: () => null }));
vi.mock("../../components/planning/StartReturnModal", () => ({
  StartReturnModal: () => <div data-testid="start-return" />,
}));
vi.mock("../../lib/planning-gap", () => ({
  buildPlanningGap: () => ({}),
  buildPlanningProjects: () => ({}),
  findPlanningProject: () => null,
}));

import Layout from "../partners-crm-layout";
import Directory from "../core.partners.directory";
import Planning from "../core.partners.planning";

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function mount(path: string, loaderData: object, Page: () => React.ReactElement | null) {
  const router = createMemoryRouter(
    [{ Component: Layout, children: [{ path: path.split("?")[0], loader: () => loaderData, Component: Page }] }],
    { initialEntries: [path] },
  );
  return { router, ...renderDom(<RouterProvider router={router} />) };
}

const row = (c: HTMLElement) => c.querySelector("[data-density]")!;
const labelled = (c: HTMLElement, label: string) => c.querySelector<HTMLElement>(`[aria-label="${label}"]`);

const planningData = (over: object = {}) => ({
  terms: [{ id: "t1", code: "26F" }],
  termId: "t1",
  hasIntentData: true,
  replied: 3,
  roster: 10,
  intentSetup: { kind: "ready" },
  domains: [],
  items: [],
  listOnlyItems: [],
  maintaining: [],
  projectInfo: {},
  applicationInfo: {},
  returnableProjects: [],
  returning: [],
  coreMembers: [],
  spotDomains: [],
  ...over,
});

describe("Partner pages hand their controls to the page row", () => {
  it("directory: search, filters, export and a primary New menu", async () => {
    const { container } = mount("/core/partners/directory", { rows: [] }, Directory as never);
    await settle();
    const r = row(container);
    expect(r.contains(container.querySelector('input[aria-label="Search the directory"]'))).toBe(true);
    expect(r.textContent).toContain("0 records");
    expect([...r.querySelectorAll("button")].some((b) => b.textContent === "Export CSV")).toBe(true);
    const primary = [...r.querySelectorAll("button")].find((b) => b.textContent?.includes("New"))!;
    click(primary);
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim());
    expect(items).toEqual(["Organization", "Individual partner", "Contact"]);
  });

  it("planning: group toggle, option toggles, term filter and the Start a return primary", async () => {
    const { container, router } = mount("/core/partners/planning?group=domain", planningData(), Planning as never);
    await settle();
    const r = row(container);
    expect(r.textContent).toContain("3 of 10 replied");
    expect(r.querySelector('[role="group"][aria-label="Group by"]')).not.toBeNull();
    const backlog = labelled(container, "Include backlog") ?? [...r.querySelectorAll("button")].find((b) => b.textContent === "Include backlog")!;
    expect(backlog.getAttribute("aria-pressed")).toBe("false");
    click(backlog);
    expect(
      [...r.querySelectorAll("button")].find((b) => b.textContent === "Include backlog")!.getAttribute("aria-pressed"),
    ).toBe("true");
    click(r.querySelector('[aria-label="Group by project"]')!);
    await settle();
    expect(router.state.location.search).not.toContain("group=domain");
    expect(container.textContent).not.toContain("3 of 10 replied");
    expect(r.textContent).toContain("26F");
    expect(container.querySelector('[data-testid="start-return"]')).toBeNull();
    click([...r.querySelectorAll("button")].find((b) => b.textContent === "Start a return")!);
    expect(container.querySelector('[data-testid="start-return"]')).not.toBeNull();
  });

  it("planning: no term filter or primary without a term", async () => {
    const { container } = mount("/core/partners/planning", planningData({ termId: null }), Planning as never);
    await settle();
    expect(row(container).textContent).not.toContain("Start a return");
  });
});
