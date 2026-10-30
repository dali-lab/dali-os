import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flyPromAuth, getFlyDayByApp, getFlyEgressByApp, getFlyMachineHoursByApp } from "../fly.server";

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

  it("authenticates with the FlyV1 scheme", async () => {
    fetchMock.mockResolvedValueOnce(prom([]));
    await getFlyMachineHoursByApp("fm2_abc", "dali");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "FlyV1 fm2_abc" });
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

describe("flyPromAuth", () => {
  it("prefixes a bare token", () => {
    expect(flyPromAuth("fm2_abc")).toBe("FlyV1 fm2_abc");
  });

  it("keeps a token pasted with its FlyV1 prefix as is", () => {
    expect(flyPromAuth("FlyV1 fm2_abc,fm2_def")).toBe("FlyV1 fm2_abc,fm2_def");
  });

  it("swaps a Bearer prefix and trims whitespace", () => {
    expect(flyPromAuth("  Bearer fo1_abc \n")).toBe("FlyV1 fo1_abc");
  });
});

describe("getFlyDayByApp", () => {
  const day = new Date("2026-10-25T00:00:00Z");
  const queries = () => fetchMock.mock.calls.map((c) => new URL(c[0] as string).searchParams);

  it("reads a whole past day ending at midnight", async () => {
    fetchMock.mockImplementation(async () => prom([]));
    await getFlyDayByApp("tok", "dali", day, new Date("2026-10-27T15:00:00Z"));
    expect(queries().map((q) => q.get("time"))).toEqual(Array(4).fill(String(Date.parse("2026-10-26T00:00:00Z") / 1000)));
    expect(queries().map((q) => q.get("query"))).toEqual([
      "sum by (app) (increase(fly_edge_http_responses_count[86400s]))",
      'sum by (app) (increase(fly_edge_http_responses_count{status=~"5.."}[86400s]))',
      "histogram_quantile(0.95, sum by (app, le) (rate(fly_app_http_response_time_seconds_bucket[86400s]))) * 1000",
      "max by (app) (max_over_time((fly_instance_memory_mem_total - fly_instance_memory_mem_available)[86400s:5m]))",
    ]);
  });

  it("reads today only up to now", async () => {
    fetchMock.mockImplementation(async () => prom([]));
    await getFlyDayByApp("tok", "dali", day, new Date("2026-10-25T06:00:00Z"));
    expect(queries()[0].get("time")).toBe(String(Date.parse("2026-10-25T06:00:00Z") / 1000));
    expect(queries()[0].get("query")).toContain("[21600s]");
  });

  it("reads nothing for a day that hasn't started", async () => {
    expect(await getFlyDayByApp("tok", "dali", day, new Date("2026-10-24T23:00:00Z"))).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rounds counts, keeps measurements, and drops a quantile over no requests", async () => {
    fetchMock
      .mockResolvedValueOnce(prom([{ app: "web", v: "1199.6" }]))
      .mockResolvedValueOnce(prom([{ app: "web", v: "2.4" }]))
      .mockResolvedValueOnce(prom([{ app: "web", v: "412.5" }, { app: "worker", v: "NaN" }]))
      .mockResolvedValueOnce(prom([{ app: "web", v: "500000000" }]));
    expect(await getFlyDayByApp("tok", "dali", day, new Date("2026-10-27T00:00:00Z"))).toEqual([
      { appName: "web", metric: "requests", value: 1200 },
      { appName: "web", metric: "errors_5xx", value: 2 },
      { appName: "web", metric: "p95_ms", value: 412.5 },
      { appName: "web", metric: "memory_peak_bytes", value: 5e8 },
    ]);
  });
});
