import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFlyEgressByApp, getFlyMachineHoursByApp } from "../fly.server";

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const prom = (rows: { app?: string; v: string }[]) =>
  new Response(JSON.stringify({ data: { result: rows.map((r) => ({ metric: { app: r.app }, value: [0, r.v] })) } }));

describe("getFlyMachineHoursByApp", () => {
  it("counts running minutes per app over 24h as hours", async () => {
    fetchMock.mockResolvedValueOnce(prom([{ app: "web", v: "36.5" }, { v: "1" }]));
    expect(await getFlyMachineHoursByApp("tok", "dali")).toEqual([{ appName: "web", machineHours: 36.5 }]);
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/prometheus/dali/api/v1/query");
    expect(url.searchParams.get("query")).toBe(
      "sum by (app) (sum_over_time((fly_instance_up == bool 1)[24h:1m])) / 60",
    );
  });

  it("throws on a Prometheus error", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(getFlyMachineHoursByApp("tok", "dali")).rejects.toThrow("401");
  });
});

describe("getFlyEgressByApp", () => {
  it("reads 24h edge egress per app", async () => {
    fetchMock.mockResolvedValueOnce(prom([{ app: "web", v: "1024" }]));
    expect(await getFlyEgressByApp("tok", "dali")).toEqual([{ appName: "web", egressBytes: 1024 }]);
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get("query")).toBe(
      "sum by (app) (increase(fly_edge_data_out[24h]))",
    );
  });
});
