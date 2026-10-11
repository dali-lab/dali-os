import { describe, expect, it } from "vitest";

import { renderMemberEmailDocument, type MemberEmailArgs } from "~/email/lib/member-email";

const BASE = "https://os.dali.dartmouth.edu";

const ARGS: MemberEmailArgs = {
  firstName: "Ada",
  title: "Task assigned: ship the thing",
  body: "You were assigned a task.\n\nIt is due Friday.",
  link: `${BASE}/projects/1/tasks/2`,
  linkLabel: "Open the task",
  baseUrl: BASE,
};

function links(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*href="([^"]*)"/gi)].map((m) => m[1]).sort();
}

function words(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

describe("renderMemberEmailDocument content", () => {
  it("links the CTA and the notification settings", () => {
    expect(links(renderMemberEmailDocument(ARGS).html)).toEqual([
      `${BASE}/projects/1/tasks/2`,
      `${BASE}/settings/notifications`,
    ]);
  });

  it("carries the greeting, title and body text", () => {
    const document = words(renderMemberEmailDocument(ARGS).html);
    for (const phrase of [
      "Hi Ada,",
      "Task assigned: ship the thing",
      "You were assigned a task.",
      "It is due Friday.",
      "Open the task",
    ]) {
      expect(document).toContain(phrase);
    }
  });

  it("drops the in-body title when the caller asks", () => {
    const document = renderMemberEmailDocument({ ...ARGS, titleInBody: false }).html;
    // Still the subject, just not repeated as a heading.
    expect(document).not.toContain("<h1");
  });

  it("omits the CTA when there is no link", () => {
    expect(links(renderMemberEmailDocument({ ...ARGS, link: null }).html)).toEqual([
      `${BASE}/settings/notifications`,
    ]);
  });
});

describe("renderMemberEmailDocument escaping", () => {
  // The fragment interpolated these raw. Names and titles come from the DB and
  // carry whatever a member or partner typed.
  it("escapes the first name", () => {
    const { html } = renderMemberEmailDocument({
      ...ARGS,
      firstName: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes the title", () => {
    const { html } = renderMemberEmailDocument({
      ...ARGS,
      title: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("still sanitizes a rich body", () => {
    const { html } = renderMemberEmailDocument({
      ...ARGS,
      body: null,
      bodyHtml: '<p>ok</p><script>alert(1)</script><a href="javascript:x">bad</a>',
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("ok");
  });
});

describe("renderMemberEmailDocument text part", () => {
  it("includes the CTA as a bare URL, because text has no button", () => {
    const { text } = renderMemberEmailDocument(ARGS);
    expect(text).toContain(`Open the task: ${BASE}/projects/1/tasks/2`);
  });

  it("includes the greeting, title and body", () => {
    const { text } = renderMemberEmailDocument(ARGS);
    expect(text).toContain("Hi Ada,");
    expect(text).toContain("Task assigned: ship the thing");
    expect(text).toContain("You were assigned a task.");
  });

  it("carries no markup", () => {
    const { text } = renderMemberEmailDocument({
      ...ARGS,
      body: null,
      bodyHtml: "<p>Rich <strong>body</strong> with a <em>link</em>.</p>",
    });
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).toContain("Rich body with a link.");
  });

  it("is never empty, so no send ships a blank alternative", () => {
    const { text } = renderMemberEmailDocument({
      firstName: "Ada",
      title: "Something happened",
      baseUrl: BASE,
    });
    expect(text.trim().length).toBeGreaterThan(0);
  });
});
