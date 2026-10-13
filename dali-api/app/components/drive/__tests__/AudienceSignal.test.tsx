import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudienceDetail, AudienceSignal } from "~/components/drive/AudienceSignal";
import type { Audience } from "~/lib/page-audience";

const base: Audience = { kind: "private", label: "Only you", permission: "Edit" };
const signal = (audience: Audience, onOpenShare?: () => void) =>
  renderToStaticMarkup(createElement(AudienceSignal, { audience, onOpenShare }));
const detail = (audience: Audience, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(AudienceDetail, { audience, ...extra }));

const people = [
  { id: "u1", name: "Ada Lovelace", photoUrl: null },
  { id: "u2", name: "Grace Hopper", photoUrl: "https://x/g.png" },
  { id: "u3", name: "Alan Turing", photoUrl: null },
];

describe("AudienceSignal glyphs", () => {
  it("shows a lock for private", () => {
    const html = signal(base);
    expect(html).toContain('data-audience-kind="private"');
    expect(html).toContain("lucide-lock");
  });

  it("shows people with the count", () => {
    const html = signal({ kind: "people", label: "Shared with 3 people and groups", count: 3, permission: "View" });
    expect(html).toContain("lucide-users");
    expect(html).toContain(">3<");
  });

  it("shows a chip with the group name", () => {
    const html = signal({ kind: "group", label: "Core", permission: "Edit" });
    expect(html).toContain(">Core<");
    expect(html).toContain("border");
  });

  it("shows people with 'Team' for a project", () => {
    const html = signal({ kind: "project", label: "Project team · lab can view", permission: "Edit" });
    expect(html).toContain("lucide-users");
    expect(html).toContain(">Team<");
  });

  it.each(["lab", "public"] as const)("shows a globe for %s", (kind) => {
    expect(signal({ ...base, kind, label: "x" })).toContain("lucide-globe");
  });

  it("swaps the glyph for an avatar stack with +N when people are present", () => {
    const html = signal({ ...base, kind: "people", label: "x", count: 5, people });
    expect(html).not.toContain("lucide-users");
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Alan Turing");
    expect(html).toContain("-ml-1.5");
    expect(html).toContain("ring-background");
    expect(html).toContain("+2");
  });

  it("shows no +N when every share is in the stack", () => {
    const html = signal({ ...base, kind: "people", label: "x", count: 3, people });
    expect(html).not.toContain("+");
  });

  it("labels the control with the audience", () => {
    expect(signal(base)).toContain('aria-label="Who can see this: Only you"');
  });

  it("is a button only when Share can open", () => {
    expect(signal(base, vi.fn())).toContain("<button");
    expect(signal(base)).not.toContain("<button");
  });
});

describe("AudienceDetail", () => {
  it("states the label and tier", () => {
    const html = detail({ kind: "group", label: "Core", permission: "Comment" });
    expect(html).toContain("Core");
    expect(html).toContain("Can comment");
  });

  it("links the inherited-from folder when it can navigate", () => {
    const aud = { ...base, inheritedFrom: { id: "f1", title: "Hiring" } };
    expect(detail(aud, { onOpenFolder: vi.fn() })).toContain('data-testid="audience-inherited-link"');
    expect(detail(aud)).not.toContain('data-testid="audience-inherited-link"');
    expect(detail(aud)).toContain("Hiring");
  });

  it("lists people and the remainder", () => {
    const html = detail({ ...base, kind: "people", label: "x", count: 5, people });
    expect(html).toContain("Grace Hopper");
    expect(html).toContain("+2 more");
  });

  it("mentions named shares on non-people audiences", () => {
    expect(detail({ kind: "project", label: "Project team", count: 2, permission: "Edit" })).toContain(
      "Plus 2 named shares",
    );
  });

  it("offers Manage only to managers, and only when it can open Share", () => {
    const aud = { ...base, canManage: true };
    expect(detail(aud, { onManage: vi.fn() })).toContain('data-testid="audience-manage"');
    expect(detail(base, { onManage: vi.fn() })).not.toContain('data-testid="audience-manage"');
    expect(detail(aud)).not.toContain('data-testid="audience-manage"');
  });
});
