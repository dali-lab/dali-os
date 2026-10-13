import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TagDots, TagLabels } from "~/components/drive/TagDots";
import type { DriveItemTag } from "~/lib/drive-tags";

const tag = (i: number, color: string | null = "#ff0000"): DriveItemTag => ({ id: `t${i}`, label: `Tag ${i}`, color });
const render = (tags: DriveItemTag[] | undefined, onApply?: (id: string) => void) =>
  renderToStaticMarkup(createElement(TagDots, { tags, onApply }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("TagDots", () => {
  it("renders nothing without tags", () => {
    expect(render(undefined)).toBe("");
    expect(render([])).toBe("");
  });

  it("renders one 8px ringed dot per tag in the tag's color", () => {
    const html = render([tag(1, "#ff0000"), tag(2, "#00ff00")]);
    expect(count(html, 'data-testid="tag-dot"')).toBe(2);
    expect(html).toContain("background-color:#ff0000");
    expect(html).toContain("background-color:#00ff00");
    expect(html).toContain("h-2 w-2 rounded-full ring-1 ring-background");
    expect(html).not.toContain("tag-dots-overflow");
  });

  it("caps at three dots and shows +N muted for the rest", () => {
    const html = render([1, 2, 3, 4, 5].map((i) => tag(i)));
    expect(count(html, 'data-testid="tag-dot"')).toBe(3);
    expect(html).toMatch(/data-testid="tag-dots-overflow"[^>]*>\+2</);
    expect(html).toContain("text-muted-foreground");
  });

  it("falls back to a neutral dot for a non-hex color", () => {
    const html = render([tag(1, "bg-red-500"), tag(2, null)]);
    expect(count(html, "bg-muted-foreground/50")).toBe(2);
    expect(html).not.toContain("background-color");
  });

  it("is plain spans, not buttons, without a handler", () => {
    const html = render([tag(1)]);
    expect(html).not.toContain("<button");
  });

  it("makes each dot a labelled button when a handler is given", () => {
    const html = render([tag(1), tag(2)], vi.fn());
    expect(count(html, "<button")).toBe(2);
    expect(html).toContain('aria-label="Filter by tag Tag 1"');
    expect(html).toContain('aria-label="Filter by tag Tag 2"');
  });
});

describe("TagLabels", () => {
  it("lists every label, not just three, each with its dot", () => {
    const html = renderToStaticMarkup(createElement(TagLabels, { tags: [1, 2, 3, 4].map((i) => tag(i)) }));
    for (const i of [1, 2, 3, 4]) expect(html).toContain(`Tag ${i}`);
    expect(count(html, "<li")).toBe(4);
    expect(count(html, "background-color:#ff0000")).toBe(4);
  });
});
