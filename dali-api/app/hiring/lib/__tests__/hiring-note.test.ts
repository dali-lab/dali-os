import { describe, expect, it } from "vitest";
import { HIRING_NOTE_MAX, canEditHiringNote, normalizeHiringNote } from "~/hiring/lib/hiring-note";

const roles = (r: Partial<{ isAdmin: boolean; isCore: boolean; isDomainLead: boolean }>) => ({
  isAdmin: false,
  isCore: false,
  isDomainLead: false,
  ...r,
});

describe("canEditHiringNote", () => {
  it("lets Admin edit on any cycle", () => {
    expect(canEditHiringNote(roles({ isAdmin: true }), false)).toBe(true);
    expect(canEditHiringNote(roles({ isAdmin: true }), true)).toBe(true);
  });

  it("lets Core and domain leads edit on ordinary cycles", () => {
    expect(canEditHiringNote(roles({ isCore: true }), false)).toBe(true);
    expect(canEditHiringNote(roles({ isDomainLead: true }), false)).toBe(true);
  });

  it("keeps Core and domain leads out on Core cycles", () => {
    expect(canEditHiringNote(roles({ isCore: true }), true)).toBe(false);
    expect(canEditHiringNote(roles({ isDomainLead: true }), true)).toBe(false);
  });

  it("never lets a plain reviewer edit", () => {
    expect(canEditHiringNote(roles({}), false)).toBe(false);
  });
});

describe("normalizeHiringNote", () => {
  it("trims the text", () => {
    expect(normalizeHiringNote("  Late: approved by Lorie  ")).toBe("Late: approved by Lorie");
  });

  it("turns blank or missing input into no note", () => {
    expect(normalizeHiringNote("   ")).toBeNull();
    expect(normalizeHiringNote("")).toBeNull();
    expect(normalizeHiringNote(null)).toBeNull();
    expect(normalizeHiringNote(42)).toBeNull();
  });

  it("caps the length", () => {
    expect(normalizeHiringNote("x".repeat(HIRING_NOTE_MAX + 50))).toHaveLength(HIRING_NOTE_MAX);
  });
});
