import { describe, expect, it } from "vitest";
import { renderEmailDocument } from "~/email/lib/layout";

const BASE = "https://os.dali.dartmouth.edu";

function render(overrides: Partial<Parameters<typeof renderEmailDocument>[0]> = {}) {
  return renderEmailDocument({
    bodyHtml: "<p>Hello there.</p>",
    baseUrl: BASE,
    ...overrides,
  });
}

// String assertions rather than a DOM: house style, and it keeps these tests
// dependency-free (jsdom ships no types here).
function attrOf(html: string, tag: string, attr: string): string | null {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, "i"));
  return m ? m[1] : null;
}
function openTags(html: string, tag: string): string[] {
  return html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) ?? [];
}
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("renderEmailDocument structure", () => {
  it("emits a real HTML document", () => {
    const html = render();
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<html");
    expect(html).toContain("</html>");
  });

  // The three most common accessibility failures in email have no axe-core rule
  // and no off-the-shelf checker, so they are asserted by hand.
  it("sets lang and dir, which nothing else checks for us", () => {
    const html = render();
    expect(attrOf(html, "html", "lang")).toBe("en");
    expect(attrOf(html, "html", "dir")).toBe("ltr");
  });

  it("marks every layout table as presentational", () => {
    const html = render({ cta: { href: `${BASE}/x`, label: "Open" } });
    const tables = openTags(html, "table");
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t).toContain('role="presentation"');
    }
  });

  it("declares both colour schemes so clients do not invent their own", () => {
    const html = render();
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain("color-scheme: light dark");
  });

  it("handles dark mode for Outlook.com separately from the media query", () => {
    const html = render();
    // Outlook.com rewrites low-contrast colours and stashes originals in
    // data-ogsc; it never honours prefers-color-scheme, and it prefixes every
    // class with x_, so it must be excluded from the media query.
    expect(html).toContain("[data-ogsc]");
    expect(html).toContain('not([class^="x_"])');
  });

  it("gives Outlook a fixed-width ghost table around the fluid one", () => {
    const html = render();
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("width=\"600\"");
  });

  it("avoids pure black and white, which clients special-case by exact value", () => {
    const html = render();
    expect(html).not.toMatch(/#ffffff\b/i);
    expect(html).not.toMatch(/#000000\b/i);
  });

  it("uses no CSS that the Word engine drops", () => {
    const html = render({ cta: { href: `${BASE}/x`, label: "Open" } });
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
    expect(html).not.toContain("border-radius");
    expect(html).not.toMatch(/\d(rem|vw|vh)\b/);
  });

  it("stays well under the Gmail clipping threshold for a typical body", () => {
    const html = render({ bodyHtml: "<p>short</p>" });
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(102_400);
  });
});

describe("renderEmailDocument content", () => {
  it("places the body inside the document", () => {
    expect(textOf(render({ bodyHtml: "<p>Specific body text.</p>" }))).toContain(
      "Specific body text.",
    );
  });

  it("renders the CTA as a real link with the given label", () => {
    const html = render({ cta: { href: `${BASE}/tasks/1`, label: "Open the task" } });
    expect(html).toContain(`href="${BASE}/tasks/1"`);
    expect(html).toContain(">Open the task</a>");
  });

  it("escapes a CTA href so a quote cannot break out of the attribute", () => {
    const html = render({ cta: { href: '" onmouseover="x', label: "Go" } });
    expect(html).not.toContain('href="" onmouseover="x"');
    expect(html).toContain("&quot;");
  });

  it("hides the preheader from the rendered body but keeps it in the source", () => {
    const html = render({ preheader: "Two updates waiting" });
    expect(html).toContain("Two updates waiting");
    expect(html).toContain("display:none");
  });

  it("omits the preheader block entirely when there is none", () => {
    expect(render({ preheader: null })).not.toContain("max-height:0");
  });
});

describe("renderEmailDocument footers", () => {
  it("offers notification settings on notification mail", () => {
    const html = render({ footer: "notifications" });
    expect(html).toContain(`${BASE}/settings/notifications`);
  });

  it("offers no settings link on transactional mail", () => {
    // A decision letter or a signed-agreement receipt is not something a member
    // can switch off, so offering the link would misrepresent it.
    const html = render({ footer: "transactional" });
    expect(html).not.toContain("/settings/notifications");
    expect(html).toContain("Dartmouth College");
  });

  it("can omit the footer altogether", () => {
    const html = render({ footer: "none" });
    expect(html).not.toContain("/settings/notifications");
    expect(html).not.toContain("Dartmouth College");
  });

  it("uses a middot rather than an em dash", () => {
    // House copy style: no em dashes in product copy.
    const html = render({ footer: "notifications" });
    expect(html).toContain("&middot;");
    expect(html).not.toContain("— DALI OS");
  });
});

describe("renderEmailDocument env notice", () => {
  it("places the notice inside body, never before the doctype", () => {
    const html = render({ envNotice: '<div id="n">staging</div>' });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    const bodyAt = html.search(/<body\b/i);
    expect(html.indexOf('<div id="n">')).toBeGreaterThan(bodyAt);
  });
});
