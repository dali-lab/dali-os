import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Regression guard for the "server code leaked into a client route" class of
// bug. `~/lib/db` instantiates a PrismaClient at module load and pulls in the
// ~4.8MB Prisma query-compiler wasm; `~/lib/rate-limit` used to start a
// setInterval at module load. Both are top-level side effects that rolldown
// cannot tree-shake, so any route whose CLIENT bundle retains them ships that
// weight to the browser. When it lands on a route that actually renders, it has
// broken the page before (the activity-viewer incident).
//
// Resource routes (loader/action only, no default export) are never fetched by
// the browser, so a stray db import there is build bloat, not a user-facing
// leak — we allow it but assert no COMPONENT route (hasDefaultExport) ships it.
//
// The check reads the built React Router manifest. It's a no-op when there's no
// build (unit CI without `npm run build`), so it never blocks that job; it bites
// in build-check / local post-build runs where the artifact exists.

const ASSETS_DIR = path.resolve(__dirname, "../../../build/client/assets");

const FORBIDDEN_CHUNK = /(^|\/)(db-|query_compiler|prisma)/i;

function findManifest(): string | null {
  if (!fs.existsSync(ASSETS_DIR)) return null;
  const file = fs
    .readdirSync(ASSETS_DIR)
    .find((f) => /^manifest-.*\.js$/.test(f));
  return file ? path.join(ASSETS_DIR, file) : null;
}

type RouteEntry = { imports?: string[]; hasDefaultExport?: boolean };

describe("client bundle leak guard", () => {
  it("no component-bearing route ships the Prisma/db chunk", () => {
    const manifestPath = findManifest();
    if (!manifestPath) {
      // No build artifact — nothing to assert. Not a failure.
      return;
    }

    const src = fs.readFileSync(manifestPath, "utf8");
    const json = src
      .replace(/^window\.__reactRouterManifest=/, "")
      .replace(/;?\s*$/, "");
    const manifest = JSON.parse(json) as {
      routes: Record<string, RouteEntry>;
    };

    const leakingComponentRoutes = Object.entries(manifest.routes)
      .filter(
        ([, r]) =>
          r.hasDefaultExport &&
          (r.imports ?? []).some((imp) => FORBIDDEN_CHUNK.test(imp)),
      )
      .map(([id]) => id);

    expect(
      leakingComponentRoutes,
      `These rendered routes ship server-only DB code to the browser. A route ` +
        `that renders must reach Prisma only through a *.server.ts helper, ` +
        `never via a direct top-level \`import { prisma } from "~/lib/db"\`: ` +
        `${leakingComponentRoutes.join(", ")}`,
    ).toEqual([]);
  });
});
