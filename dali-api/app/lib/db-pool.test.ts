import { describe, it, expect } from "vitest";
import { poolConfig } from "./db-pool";

const URL = "postgresql://ada:pw@localhost/dali";

describe("poolConfig", () => {
  it("defaults to 25 max, 5 warm connections, and a 5 minute idle timeout", () => {
    expect(poolConfig({ DATABASE_URL: URL })).toEqual({
      connectionString: URL,
      max: 25,
      min: 5,
      idleTimeoutMillis: 300_000,
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
