import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(import.meta.dirname, "..", "app.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const selectors = [...css.matchAll(/([^{};]+)\{/g)]
  .flatMap((m) => m[1].split(","))
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("@"));

const LIFTED = /^html(\.[\w-]+)*:root\b/;

const lastCompound = (selector: string) => selector.split(/\s+|>/).filter(Boolean).at(-1) ?? "";

describe("app.css states each rule once", () => {
  const lifted = selectors.filter((s) => LIFTED.test(s));
  const base = selectors.filter((s) => !LIFTED.test(s));

  it("never lifts a rule over another app.css rule for the same element", () => {
    const baseTargets = new Set(base.map(lastCompound));
    expect(lifted.filter((s) => baseTargets.has(lastCompound(s.replace(LIFTED, ""))))).toEqual([]);
  });

  it("keeps the os tokens on their base values", () => {
    expect(lifted.filter((s) => /^html(\.[\w-]+)*:root$/.test(s))).toEqual([]);
  });
});
