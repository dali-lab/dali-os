import { describe, it, expect } from "vitest";
import {
  interpolate,
  bodyToHtml,
  renderEmail,
  sanitizeRichEmailHtml,
  htmlToPlainText,
} from "~/lib/email";

describe("interpolate", () => {
  it("replaces every {{firstName}} occurrence", () => {
    expect(interpolate("Hi {{firstName}}, welcome {{firstName}}!", { firstName: "Ada" })).toBe(
      "Hi Ada, welcome Ada!",
    );
  });

  it("replaces {{domain}} when provided", () => {
    expect(
      interpolate("Hi {{firstName}}, you applied to {{domain}}.", {
        firstName: "Ada",
        domain: "Engineering",
      }),
    ).toBe("Hi Ada, you applied to Engineering.");
  });

  it("substitutes {{domain}} with empty string when not provided", () => {
    expect(interpolate("Hi {{firstName}} ({{domain}})", { firstName: "Ada" })).toBe("Hi Ada ()");
  });

  it("returns the input unchanged when there are no placeholders", () => {
    expect(interpolate("plain text", { firstName: "Ada" })).toBe("plain text");
  });

  it("does not interpret regex characters in firstName as a pattern", () => {
    expect(interpolate("Hi {{firstName}}", { firstName: "$&" })).toBe("Hi $&");
  });

  it("does not interpret regex characters in domain as a pattern", () => {
    expect(interpolate("Domain: {{domain}}", { firstName: "x", domain: "$1" })).toBe("Domain: $1");
  });

  it("substitutes {{time}}, {{location}}, {{meetingUrl}} when provided", () => {
    expect(
      interpolate(
        "{{firstName}} — {{time}} at {{location}} ({{meetingUrl}})",
        {
          firstName: "Ada",
          time: "Mon 3:00 PM",
          location: "Pod Appa",
          meetingUrl: "https://zoom.us/j/abc",
        },
      ),
    ).toBe("Ada — Mon 3:00 PM at Pod Appa (https://zoom.us/j/abc)");
  });

  it("substitutes optional vars with empty string when not provided", () => {
    expect(
      interpolate("{{time}}|{{location}}|{{meetingUrl}}", { firstName: "x" }),
    ).toBe("||");
  });

  it("leaves unknown placeholders as literal text (lint flags these via email-variables)", () => {
    // Regression: a typo like `{{firstname}}` was shipping verbatim — the
    // editor's lint surface now warns about it, but the interpolator itself
    // is still strict about which tokens it replaces.
    expect(interpolate("Hi {{firstname}}", { firstName: "Ada" })).toBe("Hi {{firstname}}");
  });
});

describe("bodyToHtml", () => {
  it("wraps double-newline-separated paragraphs in <p> tags", () => {
    expect(bodyToHtml("para 1\n\npara 2")).toBe("<p>para 1</p>\n<p>para 2</p>");
  });

  it("converts single newlines inside a paragraph to <br>", () => {
    expect(bodyToHtml("line 1\nline 2")).toBe("<p>line 1<br>line 2</p>");
  });

  it("handles a single paragraph with no newlines", () => {
    expect(bodyToHtml("hello")).toBe("<p>hello</p>");
  });

  it("preserves empty paragraphs as empty <p> tags", () => {
    expect(bodyToHtml("a\n\n\n\nb")).toBe("<p>a</p>\n<p></p>\n<p>b</p>");
  });

  it("strips <script> tags injected into a template body", () => {
    const out = bodyToHtml("hello<script>alert(1)</script>world");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("strips event-handler attributes on injected tags", () => {
    const out = bodyToHtml('before<img src=x onerror="alert(1)">after');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(1)");
  });

  it("strips <iframe> tags", () => {
    const out = bodyToHtml('<iframe src="javascript:alert(1)"></iframe>');
    expect(out).not.toContain("<iframe");
    expect(out).not.toContain("javascript:");
  });

  it("strips attributes on allowed tags", () => {
    const out = bodyToHtml('<p onclick="alert(1)" class="x">hi</p>');
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("alert(1)");
  });

  it("does not preserve javascript: URLs through anchor injection", () => {
    const out = bodyToHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a ");
  });
});

describe("sanitizeRichEmailHtml", () => {
  it("keeps allowed formatting and link tags", () => {
    const out = sanitizeRichEmailHtml(
      "<p><strong>Hi</strong> <em>there</em></p><ul><li>one</li></ul><h2>Head</h2>",
    );
    expect(out).toContain("<strong>Hi</strong>");
    expect(out).toContain("<em>there</em>");
    expect(out).toContain("<li>one</li>");
    expect(out).toContain("<h2>Head</h2>");
  });

  it("keeps http/https/mailto links and forces safe target/rel", () => {
    const out = sanitizeRichEmailHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(sanitizeRichEmailHtml('<a href="mailto:a@b.com">m</a>')).toContain(
      'href="mailto:a@b.com"',
    );
  });

  it("strips javascript: and data: URLs from links", () => {
    expect(sanitizeRichEmailHtml('<a href="javascript:alert(1)">x</a>')).not.toContain(
      "javascript:",
    );
    expect(sanitizeRichEmailHtml('<a href="data:text/html,x">x</a>')).not.toContain("data:");
  });

  it("strips scripts, images, and event handlers", () => {
    const out = sanitizeRichEmailHtml(
      '<p onclick="alert(1)">hi</p><script>alert(2)</script><img src=x onerror="alert(3)">',
    );
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert(");
  });
});

describe("htmlToPlainText", () => {
  it("flattens links to 'label (url)'", () => {
    expect(htmlToPlainText('<p>See <a href="https://x.com">the page</a>.</p>')).toBe(
      "See the page (https://x.com).",
    );
  });

  it("omits the url when the label already is the url", () => {
    expect(htmlToPlainText('<a href="https://x.com">https://x.com</a>')).toBe("https://x.com");
  });

  it("renders list items as bullet lines and separates paragraphs", () => {
    const out = htmlToPlainText("<p>Intro</p><ul><li>one</li><li>two</li></ul>");
    expect(out).toContain("Intro");
    expect(out).toContain("• one");
    expect(out).toContain("• two");
  });

  it("decodes common entities and strips remaining tags", () => {
    expect(htmlToPlainText("<p>a &amp; <strong>b</strong> &lt;c&gt;</p>")).toBe("a & b <c>");
  });

  it("drops script content entirely — never survives the plain-text extraction", () => {
    const out = htmlToPlainText("<p>hi<script>alert(1)</script>bye</p>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
    expect(out).toContain("hi");
    expect(out).toContain("bye");
  });
});

describe("renderEmail", () => {
  it("returns interpolated subject and HTML body in one call", () => {
    const out = renderEmail(
      { subject: "Hi {{firstName}} re: {{domain}}", body: "Hi {{firstName}},\n\nDomain: {{domain}}." },
      { firstName: "Ada", domain: "Engineering" },
    );
    expect(out.subject).toBe("Hi Ada re: Engineering");
    expect(out.html).toBe("<p>Hi Ada,</p>\n<p>Domain: Engineering.</p>");
  });

  it("matches the composition of interpolate + bodyToHtml so preview and send stay in sync", () => {
    const tmpl = { subject: "S {{firstName}}", body: "B\n{{domain}}\n\nC" };
    const vars = { firstName: "X", domain: "Y" };
    const out = renderEmail(tmpl, vars);
    expect(out.subject).toBe(interpolate(tmpl.subject, vars));
    expect(out.html).toBe(bodyToHtml(interpolate(tmpl.body, vars)));
  });

  it("sanitizes XSS payloads end-to-end so the preview render is safe", () => {
    const out = renderEmail(
      {
        subject: "Hi {{firstName}}",
        body: 'Hi {{firstName}},<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">',
      },
      { firstName: "Ada" },
    );
    expect(out.html).not.toContain("<script");
    expect(out.html).not.toContain("<img");
    expect(out.html).not.toContain("onerror");
    expect(out.html).not.toContain("alert(");
  });
});
