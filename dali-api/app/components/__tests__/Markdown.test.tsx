import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { Markdown } from "../Markdown";

const render = (md: string, internalLinks?: boolean) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Markdown internalLinks={internalLinks}>{md}</Markdown>
    </MemoryRouter>,
  );

describe("Markdown links", () => {
  it("opens every link in a new tab by default", () => {
    expect(render("[Rooms](/rooms)")).toContain('<a href="/rooms" target="_blank" rel="noreferrer"');
  });

  it("keeps app links in the same tab when asked, and external ones in a new tab", () => {
    const html = render("[Rooms](/rooms) and [Site](https://example.com)", true);
    expect(html).toMatch(/<a [^>]*href="\/rooms"(?![^>]*target)[^>]*>Rooms<\/a>/);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer"');
  });
});
