import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { Z } from "./z";

const appDir = join(import.meta.dirname, "..", "..");

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "generated" && name !== "__tests__") walk(path, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(path);
  }
  return out;
}

const OVERLAY_Z = /z-\[(?:45|46|60|70|100)\]/;

const ALLOWED = new Set([
  "components/ui/z.ts",
  "calendar/components/WeekGrid.tsx",
  "projects/components/EpicSprintManager.tsx",
  "projects/routes/projects.$id.tsx",
]);

describe("z-index scale", () => {
  it("keeps today's values", () => {
    expect(Z).toEqual({
      sticky: "z-10",
      chrome: "z-30",
      chromeTop: "z-40",
      takeover: "z-[45]",
      takeoverTop: "z-[46]",
      modal: "z-50",
      popover: "z-[60]",
      tooltip: "z-[70]",
      top: "z-[100]",
    });
  });

  it("has no raw overlay-level z-[NN] outside ui/z.ts and the allowlist", () => {
    const offenders = walk(appDir)
      .map((f) => relative(appDir, f))
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => OVERLAY_Z.test(readFileSync(join(appDir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
