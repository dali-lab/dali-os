import { describe, it, expect } from "vitest";
import { preloadTargets } from "../NavPreloader";
import type { FavoritePage } from "~/lib/user-pages.server";

const page = (id: string, href: string): FavoritePage => ({
  id,
  title: id,
  iconEmoji: null,
  workspaceType: "Project",
  favorited: false,
  href,
  isRoute: true,
  iconKind: "route",
});

describe("preloadTargets", () => {
  it("warms favorites before recents", () => {
    const targets = preloadTargets(
      [page("a", "/projects/a")],
      [page("b", "/documents/b")],
    );
    expect(targets).toEqual(["/projects/a", "/documents/b"]);
  });

  it("drops a recent that is also pinned, so it is warmed once", () => {
    const targets = preloadTargets(
      [page("a", "/projects/a")],
      [page("a2", "/projects/a"), page("c", "/members/c")],
    );
    expect(targets).toEqual(["/projects/a", "/members/c"]);
  });

  it("caps how many destinations are warmed", () => {
    const many = Array.from({ length: 10 }, (_, i) => page(`p${i}`, `/projects/${i}`));
    expect(preloadTargets(many, [], 3)).toEqual([
      "/projects/0",
      "/projects/1",
      "/projects/2",
    ]);
  });

  it("skips anything that isn't an in-app path", () => {
    const targets = preloadTargets(
      [
        page("ext", "https://dali.dartmouth.edu"),
        page("proto", "//evil.example.com/x"),
        page("ok", "/calendar"),
      ],
      [],
    );
    expect(targets).toEqual(["/calendar"]);
  });
});
