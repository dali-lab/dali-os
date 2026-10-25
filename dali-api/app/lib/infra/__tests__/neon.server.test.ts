import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flattenConsumption, getConsumption, getNeonInventory } from "../neon.server";

const fetchMock = vi.fn();

beforeEach(() => {
  process.env.INFRA_NEON_API_KEY = "test-key";
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const urls = () => fetchMock.mock.calls.map((c) => new URL(c[0] as string));

describe("flattenConsumption", () => {
  it("emits one sample per metric per bucket, keyed by the bucket start", () => {
    expect(
      flattenConsumption([
        {
          project_id: "np-a",
          branch_id: "br-1",
          periods: [
            {
              period_plan: "launch",
              period_start: "2026-10-01T00:00:00Z",
              consumption: [
                { timeframe_start: "2026-10-24T00:00:00Z", metrics: [{ metric_name: "compute_unit_seconds", value: 60 }] },
                { timeframe_start: "2026-10-25T00:00:00Z", metrics: [{ metric_name: "compute_unit_seconds", value: 30 }] },
              ],
            },
          ],
        },
      ]),
    ).toEqual([
      { projectId: "np-a", branchId: "br-1", metric: "compute_unit_seconds", value: 60, at: "2026-10-24T00:00:00Z", plan: "launch" },
      { projectId: "np-a", branchId: "br-1", metric: "compute_unit_seconds", value: 30, at: "2026-10-25T00:00:00Z", plan: "launch" },
    ]);
  });

  it("falls back to the period start when a bucket has no start", () => {
    const [s] = flattenConsumption([
      { project_id: "np-a", periods: [{ period_start: "2026-10-01T00:00:00Z", consumption: [{ metrics: [{ metric_name: "m", value: 1 }] }] }] },
    ]);
    expect(s).toMatchObject({ at: "2026-10-01T00:00:00Z", branchId: null, plan: null });
  });

  it("skips unnamed metrics", () => {
    expect(
      flattenConsumption([
        { project_id: "np-a", periods: [{ period_start: "2026-10-01T00:00:00Z", consumption: [{ metrics: [{ value: 1 }] }] }] },
      ]),
    ).toEqual([]);
  });
});

describe("getConsumption", () => {
  const opts = {
    orgId: "org-dali-1",
    scope: "projects" as const,
    granularity: "daily" as const,
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-25T12:00:00.000Z",
  };
  const page = (id: string, cursor?: string) =>
    json({
      projects: [{ project_id: id, periods: [{ period_start: "2026-10-01T00:00:00Z", consumption: [{ timeframe_start: "2026-10-01T00:00:00Z", metrics: [{ metric_name: "compute_unit_seconds", value: 1 }] }] }] }],
      ...(cursor ? { pagination: { cursor } } : {}),
    });

  it("asks for every project metric at the requested granularity", async () => {
    fetchMock.mockResolvedValueOnce(page("np-a"));
    await getConsumption(opts);
    const u = urls()[0];
    expect(u.pathname).toBe("/api/v2/consumption_history/v2/projects");
    expect(u.searchParams.get("granularity")).toBe("daily");
    expect(u.searchParams.get("metrics")!.split(",")).toHaveLength(8);
    expect(u.searchParams.get("metrics")).toContain("extra_branches_month");
  });

  it("follows the cursor until it stops changing", async () => {
    fetchMock
      .mockResolvedValueOnce(page("np-a", "c1"))
      .mockResolvedValueOnce(page("np-b", "c2"))
      .mockResolvedValueOnce(page("np-c", "c2"));
    const out = await getConsumption(opts);
    expect(out.map((s) => s.projectId)).toEqual(["np-a", "np-b", "np-c"]);
    expect(urls().map((u) => u.searchParams.get("cursor"))).toEqual([null, "c1", "c2"]);
  });

  it("stops at a page with no cursor", async () => {
    fetchMock.mockResolvedValueOnce(page("np-a"));
    await getConsumption(opts);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds the number of pages", async () => {
    let n = 0;
    fetchMock.mockImplementation(async () => page(`np-${n}`, `c${++n}`));
    await getConsumption(opts);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("reads branches with the branch metrics and project ids", async () => {
    fetchMock.mockResolvedValueOnce(json({ branches: [] }));
    await getConsumption({ ...opts, scope: "branches", granularity: "monthly", projectIds: ["np-a", "np-b"] });
    const u = urls()[0];
    expect(u.pathname).toBe("/api/v2/consumption_history/v2/branches");
    expect(u.searchParams.get("project_ids")).toBe("np-a,np-b");
    expect(u.searchParams.get("metrics")).not.toContain("extra_branches_month");
    expect(u.searchParams.get("metrics")).not.toContain("snapshot_storage_bytes_month");
  });

  it("throws on an API error so callers can treat it as no usage", async () => {
    fetchMock.mockResolvedValueOnce(new Response("plan", { status: 403 }));
    await expect(getConsumption(opts)).rejects.toThrow("403");
  });
});

describe("getNeonInventory", () => {
  it("records the org plan", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/organizations/") ? json({ plan: "launch" }) : json({ projects: [] }),
    );
    expect(await getNeonInventory("org-dali-1")).toEqual({ orgId: "org-dali-1", plan: "launch", projects: [] });
  });

  it("still sweeps when the plan can't be read", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/organizations/") ? new Response("", { status: 404 }) : json({ projects: [] }),
    );
    expect((await getNeonInventory("org-dali-1")).plan).toBeNull();
  });
});
