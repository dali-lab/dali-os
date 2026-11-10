import { describe, expect, it } from "vitest";
import { codeBlockOptions } from "./code-highlighter";

const HTML = `<div style="color: red">hi</div>
<style>
  .card { padding: 12px; }
</style>
<!-- a comment -->
<p>after</p>`;

async function scopesOf(code: string, lang: string) {
  const h = await codeBlockOptions.createHighlighter();
  await h.loadLanguage(lang as never);
  const { tokens } = h.codeToTokens(code, { lang: lang as never, theme: "github-dark", includeExplanation: true });
  return tokens.flat().map((t) => ({
    content: t.content,
    scopes: (t.explanation ?? []).flatMap((e) => e.scopes.map((s) => s.scopeName)),
  }));
}

describe("code block highlighter", () => {
  it("highlights CSS inside HTML and recovers after it", async () => {
    const tokens = await scopesOf(HTML, "html");
    expect(tokens.flatMap((t) => t.scopes).filter((s) => s.startsWith("invalid"))).toEqual([]);
    const scopesFor = (text: string) => tokens.find((t) => t.content.includes(text))!.scopes;
    expect(scopesFor("padding")).toContain("support.type.property-name.css");
    expect(scopesFor("a comment")).toContain("comment.block.html");
    expect(scopesFor("after")).not.toContain("source.css");
  });

  it("loads every language the picker offers", async () => {
    const h = await codeBlockOptions.createHighlighter();
    const ids = Object.keys(codeBlockOptions.supportedLanguages).filter((id) => id !== "text");
    for (const id of ids) await h.loadLanguage(id as never);
    expect(h.getLoadedLanguages()).toEqual(expect.arrayContaining(ids));
  });
});
