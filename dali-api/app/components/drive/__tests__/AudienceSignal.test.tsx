import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AudienceSignal, LabAudienceGlyph } from "~/components/drive/AudienceSignal";
import type { Audience } from "~/lib/page-audience";

const base: Audience = { kind: "private", label: "Only you", permission: "Edit" };
const signal = (audience: Audience, onOpenShare?: () => void) =>
  renderToStaticMarkup(createElement(AudienceSignal, { audience, onOpenShare }));
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

  it("shows people with a 'Lab' pill, and no globe, for everyone in the lab", () => {
    const html = signal({ ...base, kind: "lab", label: "Everyone in the lab" });
    expect(html).toContain('data-audience-kind="lab"');
    expect(html).toContain("lucide-users");
    expect(html).toContain(">Lab<");
    expect(html).not.toContain("lucide-globe");
  });

  it("keeps the globe for public", () => {
    const html = signal({ ...base, kind: "public", label: "Anyone with the link" });
    expect(html).toContain("lucide-globe");
    expect(html).not.toContain("lucide-users");
    expect(html).not.toContain(">Lab<");
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

describe("LabAudienceGlyph", () => {
  it("is the people icon plus a Lab pill", () => {
    const html = renderToStaticMarkup(createElement(LabAudienceGlyph));
    expect(html).toContain("lucide-users");
    expect(html).toContain(">Lab<");
  });

  it("drops the pill when unlabelled", () => {
    const html = renderToStaticMarkup(createElement(LabAudienceGlyph, { labelled: false }));
    expect(html).toContain("lucide-users");
    expect(html).not.toContain("Lab");
  });
});
