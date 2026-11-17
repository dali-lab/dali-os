// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderDom } from "~/test-utils/render";
import { CoverThumb } from "../CoverThumb";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";

describe("CoverThumb", () => {
  it("draws the pattern in its card color", () => {
    const { container } = renderDom(<CoverThumb url="pattern:poster?c=wine" className="h-8 w-8" />);
    const thumb = container.querySelector('[data-testid="cover-thumb"]') as HTMLElement;
    expect(thumb.style.backgroundColor).toBe("var(--art-wine)");
    expect(thumb.className).toBe("h-8 w-8");
    expect(thumb.querySelector("svg")).not.toBeNull();
  });

  it("renders nothing for a non-pattern value", () => {
    expect(renderDom(<CoverThumb url="uploads/a.webp" />).container.innerHTML).toBe("");
  });
});

describe("ProjectCoverImage", () => {
  it("shows a pattern cover instead of the gradient", () => {
    const { container } = renderDom(<ProjectCoverImage name="Atlas" imageUrl="pattern:poster" placeholderClassName="h-28 w-full" />);
    expect(container.querySelector('[data-testid="cover-thumb"]')!.className).toBe("h-28 w-full");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).not.toContain("A");
  });

  it("keeps the image and the initial fallback", () => {
    expect(renderDom(<ProjectCoverImage name="Atlas" imageUrl="https://x.example/a.png" />).container.querySelector("img")).not.toBeNull();
    const none = renderDom(<ProjectCoverImage name="Atlas" imageUrl={null} />).container;
    expect(none.textContent).toBe("A");
    expect(none.querySelector('[data-testid="cover-thumb"]')).toBeNull();
  });

  it("falls back to the initial for a malformed pattern", () => {
    const { container } = renderDom(<ProjectCoverImage name="Atlas" imageUrl="pattern:nope" />);
    expect(container.querySelector('[data-testid="cover-thumb"]')).toBeNull();
  });
});
