import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every destructive confirmation in the app goes through one dialog
// (app/components/ui/dialog.tsx) — see STYLE_GUIDE.md §6.3.1. Before that rule
// was written the codebase had collected three other patterns: a file-local
// ConfirmDialog component, bespoke <Modal> confirms with their own red button,
// and inline "Delete → Confirm delete" button swaps. They all drifted from the
// shared one (no warning icon, raw bg-red-600 instead of the destructive token,
// focus landing on the confirm button rather than Cancel).
//
// This test is the ratchet. It reads source rather than rendering anything, so
// it costs nothing and it fails on the pattern, not on a specific file.

const APP = join(import.meta.dirname, "..", "..", "..");

/** Files allowed to render a confirm dialog of their own. */
const ALLOWED = new Set(["components/ui/dialog.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "generated") continue;
      walk(full, out);
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = walk(APP).map((f) => ({ rel: relative(APP, f), src: readFileSync(f, "utf8") }));

describe("destructive confirmations all route through useDialog", () => {
  it("defines no second ConfirmDialog component", () => {
    const offenders = FILES.filter(
      (f) => !ALLOWED.has(f.rel) && /function ConfirmDialog\b/.test(f.src),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("has no inline two-step confirm button swap", () => {
    // The armed-button shape: a state flag whose only job is to reveal a second
    // "really?" button in place of the first.
    const offenders = FILES.filter((f) =>
      /const \[(confirmDelete|confirmingDelete|confirmRevoke|armed)\b/.test(f.src),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("fills destructive buttons from the token, not raw red utilities", () => {
    // A solid red fill with white text is the destructive-button signature, and
    // `bg-red-600 text-white` predates the token (it also doesn't invert for
    // light mode). Status dots and badges that merely tint red are a separate
    // cleanup — this guards the button fill only.
    const offenders: string[] = [];
    for (const { rel, src } of FILES) {
      src.split("\n").forEach((line, i) => {
        if (/\bbg-red-[5-9]00\b/.test(line) && /\btext-white\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
