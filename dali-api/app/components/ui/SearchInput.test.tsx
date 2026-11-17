import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchInput } from "~/components/ui/SearchInput";

describe("SearchInput leading slot", () => {
  it("draws the plain field with a search glyph by default", () => {
    const html = renderToStaticMarkup(createElement(SearchInput, { placeholder: "Find" }));
    expect(html).toContain("lucide-search");
    expect(html).toContain('placeholder="Find"');
  });

  it("puts the leading node at the start of the field in place of the glyph", () => {
    const html = renderToStaticMarkup(
      createElement(SearchInput, { placeholder: "Name", leading: createElement("span", null, "Boston") }),
    );
    expect(html).not.toContain("lucide-search");
    expect(html.indexOf("Boston")).toBeLessThan(html.indexOf("<input"));
    expect(html).toContain('placeholder="Name"');
  });
});
