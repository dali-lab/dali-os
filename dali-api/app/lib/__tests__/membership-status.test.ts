import { describe, it, expect } from "vitest";
import {
  resolveMembershipStatus,
  commencementDate,
  type StatusInputs,
} from "~/lib/membership-status";

// Fixed "now": just past Commencement 2026, before Commencement 2027.
const NOW = new Date("2026-07-01T00:00:00Z");

// A member with no signals at all — the neutral baseline each case overrides.
const base: StatusInputs = {
  membershipStatusOverride: null,
  graduatedAt: null,
  classYear: null,
  dartmouthIsAlum: null,
  dartmouthIsStudent: null,
  dartmouthAffiliation: null,
};

const resolve = (over: Partial<StatusInputs>) =>
  resolveMembershipStatus({ ...base, ...over }, NOW);

describe("commencementDate", () => {
  it("is June 15 of the class year", () => {
    const d = commencementDate(2026);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June, 0-indexed
    expect(d.getDate()).toBe(15);
  });
});

describe("resolveMembershipStatus", () => {
  it("returns Active when no signal points at graduation (staff / current member)", () => {
    expect(resolve({})).toBe("Active");
  });

  it("manual override wins over every derived signal", () => {
    // Override Active despite a degree-conferred signal (BE dual-degree case).
    expect(
      resolve({ membershipStatusOverride: "Active", dartmouthIsAlum: true }),
    ).toBe("Active");
    // Override Alumni despite looking like a current student.
    expect(
      resolve({
        membershipStatusOverride: "Alumni",
        dartmouthIsStudent: true,
        classYear: 2027,
      }),
    ).toBe("Alumni");
  });

  it("degree conferred (Alum affiliation) => Alumni", () => {
    expect(resolve({ dartmouthIsAlum: true })).toBe("Alumni");
  });

  it("IDM ALUMNI affiliation code => Alumni", () => {
    expect(resolve({ dartmouthAffiliation: "ALUMNI" })).toBe("Alumni");
  });

  it("explicit past graduatedAt => Alumni", () => {
    expect(resolve({ graduatedAt: new Date("2026-06-20") })).toBe("Alumni");
  });

  it("future graduatedAt does not graduate (falls through to Active)", () => {
    expect(resolve({ graduatedAt: new Date("2027-06-20") })).toBe("Active");
  });

  it("manual graduatedAt beats a lingering Student affiliation", () => {
    expect(
      resolve({ graduatedAt: new Date("2026-06-20"), dartmouthIsStudent: true }),
    ).toBe("Alumni");
  });

  it("Student without Alum keeps a lapsed-classYear member Active (+1 guard)", () => {
    expect(resolve({ dartmouthIsStudent: true, classYear: 2025 })).toBe(
      "Active",
    );
  });

  it("fresh grad with both Alum and lingering Student => Alumni (Alum wins)", () => {
    expect(resolve({ dartmouthIsAlum: true, dartmouthIsStudent: true })).toBe(
      "Alumni",
    );
  });

  it("classYear past Commencement with no API signals => Alumni (fallback)", () => {
    expect(resolve({ classYear: 2024 })).toBe("Alumni");
  });

  it("classYear this year, just past June 15 => Alumni", () => {
    expect(resolve({ classYear: 2026 })).toBe("Alumni");
  });

  it("future classYear => Active", () => {
    expect(resolve({ classYear: 2027 })).toBe("Active");
  });
});
