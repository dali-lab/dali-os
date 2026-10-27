// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProjectInfraView } from "../ProjectInfraView";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const quota = { activeTimeSeconds: null, computeTimeSeconds: null, writtenDataBytes: null, dataTransferBytes: null, logicalSizeBytes: null };

function fleet(over: Partial<ProjectFleet> = {}): ProjectFleet {
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
    neonDaily: [],
    flyDaily: [],
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement;
function render(project = fleet()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(ProjectInfraView, { project })));
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

  const series = (metric: string, current: number) => ({ metric, points: [], current });
  const withDaily = () =>
    fleet({
      neonDaily: [{ day: "2026-10-24", compute_unit_seconds: 7200, public_network_transfer_bytes: 1e9 }],
      usage: [
        series("compute_unit_seconds", 36_000),
        series("public_network_transfer_bytes", 2e9),
        series("root_branch_bytes_month", 5e8),
        series("egress_bytes", 1024),
      ],
    });
  const stripLabels = () =>
    Array.from(container.querySelectorAll("span.uppercase")).map((el) => el.textContent);

  it("shows the usage chart's month figures once daily Neon usage exists", () => {
    render(withDaily());
    expect(container.textContent).toContain("Est. Neon cost this month$4.12");
    expect(container.textContent).toContain("Launch plan · Last month est. $3.00");
    expect(container.textContent).toContain("Compute this month10.0 CU·h");
    expect(container.textContent).toContain("Data out this month");
    expect(container.querySelector('[aria-label="Date range"]')).not.toBeNull();
  });

  it("drops the cost line and the charted metrics from the strip when the chart shows", () => {
    render(withDaily());
    expect(container.textContent).not.toContain("Neon Launch plan");
    expect(stripLabels()).toEqual(["Root storage", "Fly egress (24h)"]);
  });

  it("keeps the strip and cost line without daily Neon usage", () => {
    render(fleet({ usage: [series("compute_unit_seconds", 3600)] }));
    expect(container.querySelector('[aria-label="Date range"]')).toBeNull();
    expect(stripLabels()).toEqual(["Compute (CU·h)"]);
    expect(container.textContent).toContain("Neon Launch plan");
  });

  it("shows the Fly traffic chart once daily Fly usage exists", () => {
    render(
      fleet({
        flyDaily: [{ day: "2026-10-24", app: "web", requests: 1200, errors_5xx: 3, p95_ms: 420, memory_peak_bytes: 5e8 }],
      }),
    );
    expect(container.textContent).toContain("Requests1,200");
    expect(container.textContent).toContain("Server errors3");
  });

  it("doesn't say there are no samples when only a chart has data", () => {
    render(
      fleet({
        flyDaily: [{ day: "2026-10-24", app: "web", requests: 1, errors_5xx: 0, p95_ms: null, memory_peak_bytes: null }],
      }),
    );
    expect(container.textContent).not.toContain("No usage samples yet.");
  });

  it("has no Fly chart without daily Fly usage", () => {
    render();
    expect(container.textContent).not.toContain("Server errors");
  });
});
