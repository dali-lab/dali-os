import { describe, it, expect, vi, afterEach } from "vitest";
import type { Pool } from "pg";
import { poolConfig, watchPoolWaits } from "./db-pool";

const URL = "postgresql://ada:pw@localhost/dali";

describe("poolConfig", () => {
  it("defaults to 25 max, 5 warm connections, and a 5 minute idle timeout", () => {
    expect(poolConfig({ DATABASE_URL: URL })).toEqual({
      connectionString: URL,
      max: 25,
      min: 5,
      idleTimeoutMillis: 300_000,
      allowExitOnIdle: true,
    });
  });

  it("reads max, min, and idle timeout from env", () => {
    expect(
      poolConfig({
        DATABASE_URL: URL,
        DATABASE_POOL_MAX: "60",
        DATABASE_POOL_MIN: "8",
        DATABASE_POOL_IDLE_TIMEOUT_MS: "60000",
      }),
    ).toMatchObject({ max: 60, min: 8, idleTimeoutMillis: 60_000 });
  });

  it("caps min at max", () => {
    expect(poolConfig({ DATABASE_POOL_MAX: "3", DATABASE_POOL_MIN: "10" })).toMatchObject({
      max: 3,
      min: 3,
    });
  });

  it("caps the default min at a smaller max", () => {
    expect(poolConfig({ DATABASE_POOL_MAX: "2" })).toMatchObject({ max: 2, min: 2 });
  });

  it.each(["", "0", "-4", "2.5", "abc"])("falls back to defaults for invalid value %j", (raw) => {
    expect(
      poolConfig({
        DATABASE_POOL_MAX: raw,
        DATABASE_POOL_MIN: raw,
        DATABASE_POOL_IDLE_TIMEOUT_MS: raw,
      }),
    ).toMatchObject({ max: 25, min: 5, idleTimeoutMillis: 300_000 });
  });

  it("passes DATABASE_URL through and leaves it undefined when unset", () => {
    expect(poolConfig({ DATABASE_URL: URL }).connectionString).toBe(URL);
    expect(poolConfig({}).connectionString).toBeUndefined();
  });
});

describe("watchPoolWaits", () => {
  type Cb = (err: Error | undefined, client?: unknown, done?: () => void) => void;

  // A pool whose checkouts resolve when the test says so, on a fake clock.
  function fakePool() {
    let clock = 0;
    const pending: Array<{ cb?: Cb; resolve?: (c: unknown) => void; reject?: (e: Error) => void }> = [];
    const client = { id: "client" };
    const pool = {
      options: { max: 60 },
      totalCount: 12,
      idleCount: 7,
      connect(cb?: Cb) {
        if (cb) {
          pending.push({ cb });
          return undefined;
        }
        return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      },
    };
    return {
      pool: pool as unknown as Pool,
      client,
      advance: (ms: number) => (clock += ms),
      now: () => clock,
      grant: (err?: Error) => {
        const p = pending.shift()!;
        if (p.cb) p.cb(err, err ? undefined : client, () => {});
        else if (err) p.reject!(err);
        else p.resolve!(client);
      },
    };
  }

  function setup() {
    const f = fakePool();
    const log = vi.fn();
    const report = watchPoolWaits(f.pool, { now: f.now, log });
    return { ...f, log, report };
  }

  afterEach(() => vi.useRealTimers());

  it("stays silent when every checkout is handed out within a tick", async () => {
    const { pool, grant, report, log } = setup();
    const checkouts = Array.from({ length: 10 }, () => pool.connect());
    checkouts.forEach(() => grant());
    await Promise.all(checkouts);
    report();
    expect(log).not.toHaveBeenCalled();
  });

  it("logs slow checkouts, the max wait, and pool counts", async () => {
    const { pool, grant, advance, report, log } = setup();
    const fast = pool.connect();
    grant();
    await fast;
    const slowA = pool.connect();
    const slowB = pool.connect();
    advance(40);
    grant();
    advance(80);
    grant();
    await Promise.all([slowA, slowB]);
    report();
    expect(log).toHaveBeenCalledWith(
      "[pg-pool] slow checkouts=2/3 maxWait=120ms max=60 total=12 idle=7",
    );
  });

  it("times callback-style checkouts, which pool.query uses", () => {
    const { pool, grant, advance, report, log, client } = setup();
    const cb = vi.fn();
    (pool.connect as unknown as (cb: Cb) => void)(cb);
    advance(100);
    grant();
    expect(cb).toHaveBeenCalledWith(undefined, client, expect.any(Function));
    report();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("slow checkouts=1/1 maxWait=100ms"));
  });

  it("passes the client through and rethrows checkout errors", async () => {
    const { pool, grant, client } = setup();
    const ok = pool.connect();
    grant();
    await expect(ok).resolves.toBe(client);
    const failed = pool.connect();
    grant(new Error("timeout exceeded when trying to connect"));
    await expect(failed).rejects.toThrow("timeout exceeded");
  });

  it("counts a failed slow checkout", async () => {
    const { pool, grant, advance, report, log } = setup();
    const failed = pool.connect().catch(() => {});
    advance(30);
    grant(new Error("boom"));
    await failed;
    report();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("slow checkouts=1/1 maxWait=30ms"));
  });

  it("resets after each report", async () => {
    const { pool, grant, advance, report, log } = setup();
    const slow = pool.connect();
    advance(50);
    grant();
    await slow;
    report();
    report();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("reports on a 30 second interval", async () => {
    vi.useFakeTimers();
    const { pool, grant, advance, log } = setup();
    const slow = pool.connect();
    advance(50);
    grant();
    await slow;
    vi.advanceTimersByTime(29_999);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
