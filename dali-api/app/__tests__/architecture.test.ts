// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const APP_DIR = path.resolve(__dirname, "..");

const NON_DOMAIN_DIRS = new Set([
  "lib",
  "components",
  "hooks",
  "routes",
  "types",
  "generated",
  "assets",
  "help",
  "__tests__",
]);

function valueImports(source: string): string[] {
  const text = source
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const specs: string[] = [];
  const named =
    /^[ \t]*(?:import|export)\s+(type\s+)?(\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+["']([^"']+)["']/gm;
  for (const m of text.matchAll(named)) {
    const [, typeOnly, clause, spec] = m;
    if (typeOnly) continue;
    if (clause.startsWith("{")) {
      const names = clause.slice(1, -1).split(",").map((n) => n.trim()).filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type "))) continue;
    }
    specs.push(spec);
  }
  for (const m of text.matchAll(/^[ \t]*import\s+["']([^"']+)["']/gm)) specs.push(m[1]);
  return specs;
}

function resolveSpecifier(from: string, spec: string, files: ReadonlySet<string>): string | null {
  let base: string;
  if (spec.startsWith("~/")) base = "app/" + spec.slice(2);
  else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  const bare = base.replace(/\.js$/, "");
  for (const candidate of [base, `${bare}.ts`, `${bare}.tsx`, `${bare}/index.ts`, `${bare}/index.tsx`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

const isRouteModule = (file: string) => file.split("/").slice(0, -1).includes("routes");
const isTestFile = (file: string) => file.includes("/__tests__/") || /\.(test|spec)\.tsx?$/.test(file);
const domainOf = (file: string) => {
  const top = file.split("/")[1];
  return top && file.split("/").length > 2 && !NON_DOMAIN_DIRS.has(top) ? top : null;
};

function routeModuleImports(sources: ReadonlyMap<string, string>): string[] {
  const files = new Set(sources.keys());
  const found: string[] = [];
  for (const [file, source] of sources) {
    if (isRouteModule(file)) continue;
    for (const spec of valueImports(source)) {
      const target = resolveSpecifier(file, spec, files);
      if (target && isRouteModule(target)) found.push(`${file} -> ${target}`);
    }
  }
  return found.sort();
}

const SERVER_ONLY_SPEC = /^(node:|@aws-sdk\/)/;

function serverOnlyLibImports(sources: ReadonlyMap<string, string>): string[] {
  const files = new Set(sources.keys());
  const found: string[] = [];
  for (const [file, source] of sources) {
    if (!file.startsWith("app/lib/") || /\.server\.tsx?$/.test(file)) continue;
    const reasons = new Set<string>();
    for (const spec of valueImports(source)) {
      if (SERVER_ONLY_SPEC.test(spec)) reasons.add(spec.startsWith("node:") ? "node:*" : "@aws-sdk/*");
      else if (resolveSpecifier(file, spec, files) === "app/lib/db.server.ts") reasons.add("db.server");
    }
    for (const reason of reasons) found.push(`${file} -> ${reason}`);
  }
  return found.sort();
}

function twoWayDomainImports(sources: ReadonlyMap<string, string>): string[] {
  const files = new Set(sources.keys());
  const edges = new Set<string>();
  for (const [file, source] of sources) {
    const from = domainOf(file);
    if (!from) continue;
    for (const spec of valueImports(source)) {
      const target = resolveSpecifier(file, spec, files);
      const to = target ? domainOf(target) : null;
      if (to && to !== from) edges.add(`${from}>${to}`);
    }
  }
  const pairs = new Set<string>();
  for (const edge of edges) {
    const [a, b] = edge.split(">");
    if (edges.has(`${b}>${a}`)) pairs.add([a, b].sort().join(" <-> "));
  }
  return [...pairs].sort();
}

function loadAppSources(): Map<string, string> {
  const sources = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "generated" || entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
        const rel = "app/" + path.relative(APP_DIR, full).split(path.sep).join("/");
        if (!isTestFile(rel)) sources.set(rel, fs.readFileSync(full, "utf8"));
      }
    }
  };
  walk(APP_DIR);
  return sources;
}

// Each entry is removed by the PR that fixes it; a stale entry fails the test.
const ROUTE_IMPORT_ALLOWLIST: string[] = [];

const SERVER_ONLY_LIB_ALLOWLIST: string[] = [
  "app/lib/auth.ts -> db.server",
  "app/lib/roles.ts -> db.server",
];

const TWO_WAY_DOMAIN_ALLOWLIST: string[] = [
  "calendar <-> rooms", // split or redirect-table follow-up
  "forms <-> projects", // split or redirect-table follow-up
  "mentorship <-> projects", // split or redirect-table follow-up
  "partners <-> projects", // split or redirect-table follow-up
];

function expectOnlyAllowed(found: string[], allowlist: string[], what: string) {
  const allowed = new Set(allowlist);
  const seen = new Set(found);
  expect(found.filter((f) => !allowed.has(f)), `new ${what}`).toEqual([]);
  expect(allowlist.filter((a) => !seen.has(a)), `stale allowlist entries (${what})`).toEqual([]);
  expect([...allowlist].sort(), "allowlist sorted").toEqual(allowlist);
}

describe("architecture guard", () => {
  const sources = loadAppSources();

  it("non-route code does not value-import route modules", () => {
    expectOnlyAllowed(routeModuleImports(sources), ROUTE_IMPORT_ALLOWLIST, "route-module imports");
  });

  it("non-.server files under app/lib do not import server-only modules", () => {
    expectOnlyAllowed(serverOnlyLibImports(sources), SERVER_ONLY_LIB_ALLOWLIST, "server-only lib imports");
  });

  it("no two domains import each other's values", () => {
    expectOnlyAllowed(twoWayDomainImports(sources), TWO_WAY_DOMAIN_ALLOWLIST, "two-way domain imports");
  });
});

describe("architecture guard parser", () => {
  it("ignores type-only imports and dynamic imports", () => {
    const src = [
      'import type { A } from "~/admin/routes/a";',
      'import { type B, type C } from "~/admin/routes/b";',
      'const m = await import("~/admin/routes/c");',
      'import { D } from "~/admin/routes/d";',
      'import { type E, F } from "~/admin/routes/e";',
      'import G from "~/admin/routes/g";',
      'import * as H from "~/admin/routes/h";',
      'export { I } from "~/admin/routes/i";',
      'export type { J } from "~/admin/routes/j";',
      'import "~/admin/routes/k";',
    ].join("\n");
    expect(valueImports(src)).toEqual([
      "~/admin/routes/d",
      "~/admin/routes/e",
      "~/admin/routes/g",
      "~/admin/routes/h",
      "~/admin/routes/i",
      "~/admin/routes/k",
    ]);
  });

  it("reads multi-line import clauses and skips commented imports", () => {
    const src = [
      "// import { X } from '~/a/routes/x';",
      "/**",
      ' * import { Y } from "~/a/routes/y";',
      " */",
      "import {",
      "  P,",
      "  type Q,",
      '} from "~/a/routes/p";',
    ].join("\n");
    expect(valueImports(src)).toEqual(["~/a/routes/p"]);
  });

  it("resolves alias, relative and .js specifiers, and ignores packages", () => {
    const files = new Set(["app/a/routes/x.ts", "app/a/lib/y.ts", "app/a/lib/z/index.ts"]);
    expect(resolveSpecifier("app/a/lib/y.ts", "~/a/routes/x", files)).toBe("app/a/routes/x.ts");
    expect(resolveSpecifier("app/a/lib/y.ts", "../routes/x.js", files)).toBe("app/a/routes/x.ts");
    expect(resolveSpecifier("app/a/routes/x.ts", "../lib/z", files)).toBe("app/a/lib/z/index.ts");
    expect(resolveSpecifier("app/a/lib/y.ts", "react", files)).toBeNull();
    expect(resolveSpecifier("app/a/lib/y.ts", "./missing", files)).toBeNull();
  });

  it("flags a non-route file importing a route module and allows route-to-route", () => {
    const sources = new Map([
      ["app/a/routes/x.ts", "export const X = 1;"],
      ["app/a/routes/w.ts", 'import { X } from "./x";'],
      ["app/b/lib/y.ts", 'import { X } from "~/a/routes/x";\nimport type { Z } from "~/a/routes/x";'],
    ]);
    expect(routeModuleImports(sources)).toEqual(["app/b/lib/y.ts -> app/a/routes/x.ts"]);
  });

  it("flags server-only imports in non-.server lib files only", () => {
    const sources = new Map([
      ["app/lib/db.server.ts", "export const prisma = {};"],
      ["app/lib/a.ts", 'import { prisma } from "~/lib/db.server";\nimport fs from "node:fs";'],
      ["app/lib/b.server.ts", 'import { prisma } from "./db.server";'],
      ["app/lib/c.ts", 'import type { P } from "~/lib/db.server";\nconst x = await import("node:path");'],
      ["app/lib/d.ts", 'import { S3Client } from "@aws-sdk/client-s3";'],
    ]);
    expect(serverOnlyLibImports(sources)).toEqual([
      "app/lib/a.ts -> db.server",
      "app/lib/a.ts -> node:*",
      "app/lib/d.ts -> @aws-sdk/*",
    ]);
  });

  it("flags only domain pairs that import values both ways", () => {
    const sources = new Map([
      ["app/a/lib/x.ts", 'import { Y } from "~/b/lib/y";\nimport { L } from "~/lib/l";'],
      ["app/b/lib/y.ts", 'import { X } from "~/a/lib/x";'],
      ["app/c/lib/z.ts", 'import { Y } from "~/b/lib/y";'],
      ["app/b/lib/t.ts", 'import type { Z } from "~/c/lib/z";'],
      ["app/lib/l.ts", 'import { X } from "~/a/lib/x";'],
    ]);
    expect(twoWayDomainImports(sources)).toEqual(["a <-> b"]);
  });
});
