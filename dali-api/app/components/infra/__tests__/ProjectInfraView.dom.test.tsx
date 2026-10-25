// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProjectInfraView } from "../ProjectInfraView";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quota = { activeTimeSeconds: null, computeTimeSeconds: null, writtenDataBytes: null, dataTransferBytes: null, logicalSizeBytes: null };

function fleet(): ProjectFleet {
  return {
    projectId: "p1",
    name: "Work Health",
    infraEnabled: true,
    configured: true,
    flyOrgSlug: "dali",
    flyAppNames: ["web", "worker"],
    flyOrgApps: [{ id: "web", name: "web" }, { id: "worker", name: "worker" }],
    neonOrgId: "org-dali-1",
    neonProjectIds: ["np-a"],
    vaultwardenGroupId: null,
    vault: null,
    vaultMembersUrl: null,
    hasFlyReadToken: true,
    hasFlyWriteToken: false,
    fly: {
      orgSlug: "dali",
      apps: ["web", "worker"].map((name) => ({
        id: name,
        name,
        status: "deployed",
        machineCount: 1,
        machines: [{ id: `m-${name}`, name: `${name}-machine`, appName: name, state: "started", region: "iad", cpuKind: "shared", cpus: 1, memoryMb: 1024, createdAt: null }],
        volumes: [],
      })),
    },
    neon: {
      orgId: "org-dali-1",
      plan: "launch",
      projects: [{ id: "np-a", name: "Alpha", regionId: "aws-us-east-2", pgVersion: 17, createdAt: null, quota, branches: [], endpoints: [] }],
    },
    neonOrgProjects: [{ id: "np-a", name: "Alpha" }],
    neonPlan: "launch",
    neonCost: { plan: "launch", thisMonth: 4.12, lastMonth: 3, byProject: { "np-a": 4.12 } },
    neonBranchUsage: {},
    flyFetchedAt: null,
    neonFetchedAt: null,
    usage: [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(ProjectInfraView, { project: fleet() })));
}
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const hrefs = () => Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("ProjectInfraView", () => {
  it("links each Fly app and machine to Fly", () => {
    render();
    expect(hrefs()).toEqual(
      expect.arrayContaining([
        "https://fly.io/apps/web",
        "https://fly.io/apps/web/machines/m-web",
        "https://fly.io/apps/worker",
        "https://fly.io/apps/worker/machines/m-worker",
      ]),
    );
  });

  it("links each database and the org to Neon", () => {
    render();
    expect(hrefs()).toEqual(
      expect.arrayContaining(["https://console.neon.tech/app/projects/np-a", "https://console.neon.tech/app/org-dali-1"]),
    );
  });

  it("gives every table fixed columns so stacked cards line up", () => {
    render();
    const tables = Array.from(container.querySelectorAll("table"));
    expect(tables.length).toBeGreaterThan(1);
    const widths = tables.map((t) => Array.from(t.querySelectorAll("col")).map((c) => c.style.width));
    for (const t of tables) expect(t.className).toContain("table-fixed");
    expect(new Set(widths.map((w) => w.join(","))).size).toBe(1);
  });

  it("uses singular counts", () => {
    render();
    expect(container.textContent).toContain("1 machine ·");
    expect(container.textContent).toContain("0 branches");
  });

  it("shows the plan and estimates", () => {
    render();
    expect(container.textContent).toContain("Neon Launch plan");
    expect(container.textContent).toContain("Est. $4.12 this month");
    expect(container.textContent).toContain("last month est. $3.00");
    expect(container.textContent).toContain("est. $4.12 this month");
  });
});
