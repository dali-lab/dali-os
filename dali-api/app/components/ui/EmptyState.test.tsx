import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("draws the dashed art above the message", () => {
    const html = renderToStaticMarkup(<EmptyState>Nothing here yet.</EmptyState>);
    expect(html).toContain("data-empty-state-art");
    expect(html).toContain("border-dashed");
    expect(html).toContain("Nothing here yet.");
  });

  it("renders actions only when given", () => {
    expect(renderToStaticMarkup(<EmptyState>Empty</EmptyState>)).not.toContain("<button");
    const html = renderToStaticMarkup(
      <EmptyState actions={<button type="button">Start blank</button>}>Empty</EmptyState>,
    );
    expect(html).toContain("Start blank");
  });

  it("adds the caller's className", () => {
    expect(renderToStaticMarkup(<EmptyState className="py-16">Empty</EmptyState>)).toContain("py-16");
  });

  it("renders a title above the message, and a title on its own", () => {
    const both = renderToStaticMarkup(<EmptyState title="Nothing here">Seed some terms.</EmptyState>);
    expect(both.indexOf("Nothing here")).toBeLessThan(both.indexOf("Seed some terms."));
    expect(both).toContain("data-empty-state-art");
    expect(renderToStaticMarkup(<EmptyState title="Only a title" />)).toContain("Only a title");
  });

  it("renders no text block with neither title nor message", () => {
    expect(renderToStaticMarkup(<EmptyState />)).not.toContain("<p");
  });
});
