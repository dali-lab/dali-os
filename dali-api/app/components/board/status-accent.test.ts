import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boardTitleStyle, osStatusAccent, type OsStatusToken } from "./status-accent";

const TOKENS: OsStatusToken[] = ["backlog", "todo", "progress", "review", "done", "cancelled"];

describe("osStatusAccent", () => {
  it("reads the v2 header tint first and falls back to the band fill", () => {
    expect(osStatusAccent("todo").fill).toBe(
      "var(--os-status-todo-header, var(--os-status-todo-fill))",
    );
  });

  it("reads the v2 header ink first and falls back to the band ink", () => {
    expect(osStatusAccent("review").ink).toBe(
      "var(--os-status-review-header-ink, var(--os-status-review-ink))",
    );
  });

  it("keeps the card edge at full strength", () => {
    expect(osStatusAccent("done").edge).toBe("var(--os-status-done-edge)");
  });

  it("draws the dot from its own token, falling back to the edge", () => {
    expect(osStatusAccent("backlog").dot).toBe(
      "var(--os-status-backlog-dot, var(--os-status-backlog-edge))",
    );
  });
});

describe("boardTitleStyle", () => {
  it("sets the title ink and the dot colour", () => {
    const accent = osStatusAccent("progress");
    expect(boardTitleStyle(accent)).toEqual({
      color: accent.ink,
      "--os-board-dot": accent.dot,
    });
  });

  it("uses the edge for the dot when an accent has no dot", () => {
    const style = boardTitleStyle({ fill: "#fff", ink: "#000", edge: "#123456" });
    expect(style).toMatchObject({ "--os-board-dot": "#123456" });
  });
});

describe("app.css v2 header tokens", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "..", "app.css"), "utf8");

  // The v2 section restates these selectors several times; the header tokens
  // sit in the last of each.
  function block(selector: string): string {
    const start = css.lastIndexOf(selector);
    expect(start).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  it.each([
    ["dark", "html[data-v2] .os-shell,\nhtml[data-v2].os-shell {"],
    ["light", "html.light[data-v2] .os-shell,\nhtml.light[data-v2].os-shell {"],
  ])("defines a header tint for every status in %s", (_mode, selector) => {
    const body = block(selector);
    for (const token of TOKENS) {
      expect(body).toContain(`--os-status-${token}-header:`);
    }
  });
});
