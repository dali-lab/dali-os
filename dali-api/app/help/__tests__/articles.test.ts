import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");

import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "~/routes";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import { helpArticles } from "../library.server";

function routePaths(entries: RouteConfigEntry[], prefix = ""): string[] {
  return entries.flatMap((r) => {
    const path = r.path ? `${prefix}/${r.path}`.replace(/\/+/g, "/") : prefix;
    return [...(r.path || r.index ? [path || "/"] : []), ...routePaths(r.children ?? [], path)];
  });
}

const PATHS = new Set(routePaths(routes as RouteConfigEntry[]));
const PATTERNS = [...PATHS].map((p) => new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}/?$`));
const isPage = (href: string) => PATTERNS.some((re) => re.test(href.split(/[?#]/)[0]));

const articles = helpArticles();
const SLUGS = articles.map((a) => a.slug);
const internalLinks = (body: string) => [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);

describe("help articles", () => {
  it("all parse, with unique slugs", () => {
    expect(articles.length).toBeGreaterThan(1);
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length);
  });

  it.each(articles.map((a) => [a.slug, a] as const))("%s names real flags, paths and links", (_slug, a) => {
    if (a.flag) expect(FEATURE_FLAGS.map((f) => f.key)).toContain(a.flag);
    for (const path of a.paths) expect(PATHS, `paths: ${path}`).toContain(path);
    for (const href of internalLinks(a.body)) {
      expect(isPage(href), `link: ${href}`).toBe(true);
      const linked = /^\/help\/articles\/([^/?#]+)/.exec(href)?.[1];
      if (linked) expect(SLUGS, `article link: ${href}`).toContain(linked);
      const target = articles.find((t) => t.slug === linked);
      if (target?.flag) expect(target.flag, `links to flagged ${linked}`).toBe(a.flag);
    }
  });

  it.each(articles.map((a) => [a.slug, a] as const))("%s follows the copy rules", (_slug, a) => {
    for (const text of [a.title, a.summary, a.body]) expect(text).not.toMatch(/—/);
    expect(a.summary.length).toBeLessThanOrEqual(200);
    expect(a.title).toMatch(/^[A-Z0-9⌘]/);
    expect(a.body).not.toMatch(/^# /m);
  });
});
