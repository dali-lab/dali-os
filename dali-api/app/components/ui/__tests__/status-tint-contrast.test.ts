import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The status-colour token sweep (#2231) turned tinted chips like
// `bg-amber-500/10 text-amber-600` into `bg-os-amber text-os-amber`, dropping the
// opacity: the fill became the same colour as the label and the text vanished
// (the project status bar's overdue chips). Reads source, like
// no-handrolled-confirms.test.ts, so it fails on the pattern in any file.

const APP = join(import.meta.dirname, "..", "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "generated") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Tokens a class string fills solid and also uses as its text colour. */
export function sameColourFillAndText(classes: string): string[] {
  const solidFills = new Set(
    [...classes.matchAll(/(?<![\w:/-])bg-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)].map((m) => m[1]!),
  );
  return [...classes.matchAll(/(?<![\w:/-])text-([a-z]+(?:-[a-z]+)*)(?![\w/-])/g)]
    .map((m) => m[1]!)
    .filter((token) => solidFills.has(token));
}

describe("sameColourFillAndText", () => {
  it("flags a solid fill under text of the same token", () => {
    expect(sameColourFillAndText("border-os-amber bg-os-amber text-os-amber")).toEqual(["os-amber"]);
    expect(sameColourFillAndText("rounded bg-destructive px-1 text-destructive")).toEqual(["destructive"]);
  });

  it("allows a tinted fill, a hover fill, or a different text token", () => {
    expect(sameColourFillAndText("border-os-amber/30 bg-os-amber/10 text-os-amber")).toEqual([]);
    expect(sameColourFillAndText("text-os-green hover:bg-os-green")).toEqual([]);
    expect(sameColourFillAndText("bg-destructive text-destructive-foreground")).toEqual([]);
    expect(sameColourFillAndText("bg-os-accent text-os-bg")).toEqual([]);
  });
});

describe("status chips keep their label readable", () => {
  it("never fills solid with the same colour as the text", () => {
    const offenders: string[] = [];
    for (const file of walk(APP)) {
      const src = readFileSync(file, "utf8");
      // Each quote kind separately, so a ternary's quoted branches inside a
      // template literal are read as the separate class lists they are.
      for (const quote of [/"([^"\n]*)"/g, /'([^'\n]*)'/g, /`([^`]*)`/g]) {
        for (const m of src.matchAll(quote)) {
          const hits = sameColourFillAndText(m[1]!.replace(/\$\{[^}]*\}/g, " "));
          if (hits.length) {
            const line = src.slice(0, m.index).split("\n").length;
            offenders.push(`${relative(APP, file)}:${line} ${hits.join(", ")}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
