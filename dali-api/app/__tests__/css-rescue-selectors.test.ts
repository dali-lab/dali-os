import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const SKIP_DIRS = new Set(["generated", "__tests__", "node_modules"]);

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out);
    } else out.push(path);
  }
  return out;
}

const appFiles = walk(join(root, "app")).filter(
  (f) => /\.(ts|tsx|css)$/.test(f) && !/\.test\./.test(f) && !f.endsWith("app/app.css"),
);
const corpus = [
  ...appFiles,
  ...walk(join(root, "app/help")),
  ...walk(join(root, "public")),
  ...walk(join(root, "node_modules/@blocknote/shadcn/dist")),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const css = readFileSync(join(root, "app/app.css"), "utf8");
const lines = css.split("\n");
const start = lines.findIndex((l) => l.startsWith("html.dark,"));
const end = lines.findIndex((l, i) => i > start && l === "}");

const rescueSelectors = lines
  .slice(start, end)
  .map((l) => l.match(/^\s*(\.[^{]+?)\s*\{.*\}\s*$/)?.[1])
  .filter((s): s is string => !!s)
  .flatMap((s) => s.split(",").map((x) => x.trim()));

const classOf = (selector: string) =>
  selector.match(/^\.((?:[A-Za-z0-9_-]|\\.)+)(?::hover)?$/)?.[1]?.replace(/\\(.)/g, "$1") ?? null;

const isReferenced = (cls: string) =>
  new RegExp(`(?<![A-Za-z0-9_:\\-])${cls.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![A-Za-z0-9_\\-]|/\\d)`).test(corpus);

describe("dark rescue selectors in app.css", () => {
  it("finds the rescue block", () => {
    expect(start).toBeGreaterThan(0);
    expect(rescueSelectors.length).toBeGreaterThan(0);
  });

  it("only uses plain class selectors", () => {
    expect(rescueSelectors.filter((s) => classOf(s) === null)).toEqual([]);
  });

  it("does not count a variant or an opacity step as a use of the bare class", () => {
    expect(isReferenced("bg-fuchsia-950")).toBe(false);
    expect(corpus.includes("hover:bg-fuchsia-950/50")).toBe(false);
  });

  it("keeps no rule whose class nothing references", () => {
    const dead = rescueSelectors.filter((s) => !isReferenced(classOf(s)!));
    expect(dead).toEqual([]);
  });
});
