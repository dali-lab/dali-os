import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  protectedFlyApps,
  protectedNeonProjectIds,
  isFlyAppProtected,
  isNeonProjectProtected,
  assertFlyAppMutable,
  assertNeonProjectMutable,
  ProtectedResourceError,
} from "~/lib/infra/guard.server";

const KEYS = ["FLY_APP_NAME", "INFRA_PROTECTED_FLY_APPS", "INFRA_PROTECTED_NEON_PROJECTS"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("protectedFlyApps", () => {
  it("includes the platform apps by default", () => {
    expect(protectedFlyApps()).toEqual(expect.arrayContaining(["dali-api-prod", "dali-api-staging"]));
  });

  it("adds FLY_APP_NAME", () => {
    process.env.FLY_APP_NAME = "dali-preview-7";
    expect(protectedFlyApps()).toContain("dali-preview-7");
  });

  it("trims env extras, drops empties and dedupes against the defaults", () => {
    process.env.INFRA_PROTECTED_FLY_APPS = " a, ,b ,dali-api-prod";
    const apps = protectedFlyApps();
    expect(apps).toEqual(expect.arrayContaining(["a", "b"]));
    expect(apps.filter((a) => a === "dali-api-prod")).toHaveLength(1);
    expect(apps).not.toContain("");
  });
});

describe("protectedNeonProjectIds", () => {
  it("protects nothing when the env var is unset", () => {
    expect(protectedNeonProjectIds()).toEqual([]);
    expect(isNeonProjectProtected("anything")).toBe(false);
  });

  it("parses the env list", () => {
    process.env.INFRA_PROTECTED_NEON_PROJECTS = " n1, ,n2 ";
    expect(protectedNeonProjectIds()).toEqual(["n1", "n2"]);
  });
});

describe("assert mutable", () => {
  it("throws a ProtectedResourceError naming the Fly app", () => {
    expect(() => assertFlyAppMutable("dali-api-prod")).toThrow(ProtectedResourceError);
    expect(() => assertFlyAppMutable("dali-api-prod")).toThrow(/"dali-api-prod"/);
  });

  it("throws naming the Neon project and passes others", () => {
    process.env.INFRA_PROTECTED_NEON_PROJECTS = "n1";
    expect(() => assertNeonProjectMutable("n1")).toThrow(/"n1"/);
    expect(() => assertNeonProjectMutable("n2")).not.toThrow();
    expect(() => assertFlyAppMutable("client-app")).not.toThrow();
  });

  it("matches exactly, not by prefix or substring", () => {
    process.env.INFRA_PROTECTED_NEON_PROJECTS = "n1";
    expect(isFlyAppProtected("dali-api-prod-2")).toBe(false);
    expect(isFlyAppProtected("dali-api")).toBe(false);
    expect(isNeonProjectProtected("n10")).toBe(false);
  });
});
