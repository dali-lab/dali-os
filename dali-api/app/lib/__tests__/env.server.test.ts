import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_NAMES, REQUIRED_DEPLOYED_ENV, checkEnv, getEnv, resetEnvForTests, warnOnBadEnv } from "../env.server";

const example = readFileSync(join(import.meta.dirname, "..", "..", "..", ".env.example"), "utf8");
const documented = [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

const REQUIRED = Object.fromEntries(REQUIRED_DEPLOYED_ENV.map((n) => [n, "x"]));
const SECRET = "s3cr3t-value-that-must-not-leak";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvForTests();
});

describe("env schema", () => {
  it("covers every variable in .env.example", () => {
    const missing = documented.filter((n) => !(ENV_NAMES as string[]).includes(n));
    expect(missing).toEqual([]);
  });

  it("requires only the database, auth secret and Google client when deployed", () => {
    expect([...REQUIRED_DEPLOYED_ENV].sort()).toEqual(
      ["BETTER_AUTH_SECRET", "DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    );
  });
});

describe("checkEnv", () => {
  it("reports nothing missing on dev with an empty env", () => {
    vi.stubEnv("DALI_APP_ENV", "dev");
    expect(checkEnv({})).toEqual({ missing: [], invalid: [] });
  });

  it("lists the required names missing on staging and prod, treating empty as unset", () => {
    for (const env of ["staging", "prod"]) {
      vi.stubEnv("DALI_APP_ENV", env);
      expect(checkEnv({ DATABASE_URL: "" }).missing.sort()).toEqual([...REQUIRED_DEPLOYED_ENV].sort());
    }
  });

  it("passes when the required set is present", () => {
    vi.stubEnv("DALI_APP_ENV", "prod");
    expect(checkEnv({ ...REQUIRED, DATABASE_URL: "postgresql://u:p@localhost:5432/db" })).toEqual({
      missing: [],
      invalid: [],
    });
  });

  it("accepts the example values and rejects bad URLs, enums and integers", () => {
    vi.stubEnv("DALI_APP_ENV", "dev");
    expect(
      checkEnv({
        FRONTEND_URL: "http://localhost:5173",
        REDIS_URL: "redis://localhost:6379",
        AI_PROVIDER: "dartmouth",
        COLLAB_PORT: "3002",
        DALI_APP_ENV: "dev",
      }).invalid,
    ).toEqual([]);
    expect(
      checkEnv({
        FRONTEND_URL: "not a url",
        AI_PROVIDER: "openai",
        COLLAB_PORT: "abc",
        DALI_APP_ENV: "qa",
      }).invalid.sort(),
    ).toEqual(["AI_PROVIDER", "COLLAB_PORT", "DALI_APP_ENV", "FRONTEND_URL"]);
  });

  it("never includes values in its result", () => {
    vi.stubEnv("DALI_APP_ENV", "prod");
    const out = checkEnv({ DATABASE_URL: SECRET, REDIS_URL: SECRET });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});

describe("getEnv", () => {
  it("does not throw with an empty env", () => {
    vi.stubEnv("VITEST", "");
    expect(() => getEnv()).not.toThrow();
  });

  it("returns values exactly as set, including empty and invalid ones", () => {
    vi.stubEnv("REDIS_URL", "nope");
    vi.stubEnv("SLACK_TEAM_ID", "");
    vi.stubEnv("ZOOM_ACCOUNT_ID", "abc");
    vi.stubEnv("ZOOM_CLIENT_ID", undefined);
    const env = getEnv();
    expect(env.REDIS_URL).toBe("nope");
    expect(env.SLACK_TEAM_ID).toBe("");
    expect(env.ZOOM_ACCOUNT_ID).toBe("abc");
    expect(env.ZOOM_CLIENT_ID).toBeUndefined();
  });

  it("re-reads on every call under Vitest", () => {
    vi.stubEnv("ZOOM_ACCOUNT_ID", "a");
    expect(getEnv().ZOOM_ACCOUNT_ID).toBe("a");
    vi.stubEnv("ZOOM_ACCOUNT_ID", "b");
    expect(getEnv().ZOOM_ACCOUNT_ID).toBe("b");
  });

  it("memoizes outside Vitest until reset", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("ZOOM_ACCOUNT_ID", "a");
    expect(getEnv()).toBe(getEnv());
    vi.stubEnv("ZOOM_ACCOUNT_ID", "b");
    expect(getEnv().ZOOM_ACCOUNT_ID).toBe("a");
    resetEnvForTests();
    expect(getEnv().ZOOM_ACCOUNT_ID).toBe("b");
  });
});

describe("warnOnBadEnv", () => {
  it("logs one line naming the variables and no values", () => {
    vi.stubEnv("DALI_APP_ENV", "prod");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("REDIS_URL", SECRET);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnOnBadEnv();
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(spy.mock.calls[0]);
    expect(line).toContain("DATABASE_URL");
    expect(line).toContain("REDIS_URL");
    expect(line).not.toContain(SECRET);
  });

  it("stays silent when nothing is wrong", () => {
    vi.stubEnv("DALI_APP_ENV", "dev");
    for (const n of ENV_NAMES) vi.stubEnv(n, "");
    vi.stubEnv("DALI_APP_ENV", "dev");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    warnOnBadEnv();
    expect(spy).not.toHaveBeenCalled();
  });
});
