import { describe, it, expect } from "vitest";
import {
  currentRoleText,
  parseMemberColumns,
  projectHistoryText,
  termsInLabText,
  type MemberHistory,
} from "../member-history";

const T = {
  "25F": { code: "25F", sortKey: 254, startDate: new Date("2025-09-15") },
  "26W": { code: "26W", sortKey: 261, startDate: new Date("2026-01-05") },
  "26F": { code: "26F", sortKey: 264, startDate: new Date("2026-09-14") },
  "27W": { code: "27W", sortKey: 271, startDate: new Date("2027-01-04") },
};
const NOW = new Date("2026-11-11");

function pa(project: string, term: keyof typeof T, domain = "Developer", level = "P2", domainId = "d-dev") {
  return { level, domainId, project: { name: project }, domain: { displayName: domain }, term: T[term] };
}
function ca(term: keyof typeof T, leadTitle: string | null = null) {
  return { leadTitle, term: T[term] };
}
const empty: MemberHistory = { projects: [], core: [] };

describe("projectHistoryText", () => {
  it("is blank for a member with no project assignments", () => {
    expect(projectHistoryText(empty)).toBe("");
  });

  it("lists each project once with its terms in order, most recent project first", () => {
    const h: MemberHistory = {
      projects: [pa("Evergreen", "26W"), pa("Ripple", "26F"), pa("Evergreen", "25F"), pa("Atlas", "26W")],
      core: [],
    };
    expect(projectHistoryText(h)).toBe("Ripple (26F); Atlas (26W); Evergreen (25F, 26W)");
  });

  it("lists a term once when the member held two domains on the same project", () => {
    const h: MemberHistory = {
      projects: [pa("Evergreen", "26F", "Developer"), pa("Evergreen", "26F", "Designer", "P1", "d-des")],
      core: [],
    };
    expect(projectHistoryText(h)).toBe("Evergreen (26F)");
  });

  it("includes projects from legacy history", () => {
    const h: MemberHistory = { projects: [pa("Old App", "25F", "Legacy", "P1", "domain_legacy")], core: [] };
    expect(projectHistoryText(h)).toBe("Old App (25F)");
  });
});

describe("termsInLabText", () => {
  it("is blank for a member with no assignments", () => {
    expect(termsInLabText(empty)).toBe("");
  });

  it("counts distinct terms across project and Core work, in order", () => {
    const h: MemberHistory = {
      projects: [pa("Evergreen", "26F"), pa("Ripple", "26F"), pa("Evergreen", "25F")],
      core: [ca("26W", "Education Lead"), ca("26F")],
    };
    expect(termsInLabText(h)).toBe("3 terms: 25F, 26W, 26F");
  });

  it("uses the singular for one term", () => {
    expect(termsInLabText({ projects: [], core: [ca("26F")] })).toBe("1 term: 26F");
  });
});

describe("currentRoleText", () => {
  it("is blank for a member with no assignments", () => {
    expect(currentRoleText(empty, NOW)).toBe("");
  });

  it("lists every role and level from the latest started term", () => {
    const h: MemberHistory = {
      projects: [
        pa("Evergreen", "26F", "Developer", "P2"),
        pa("Ripple", "26F", "Designer", "P1", "d-des"),
        pa("Atlas", "26W", "Product Manager", "P3", "d-pm"),
      ],
      core: [ca("26F", "Education Lead"), ca("26W", "Events Lead")],
    };
    expect(currentRoleText(h, NOW)).toBe("26F: Developer (P2), Designer (P1), Education Lead");
  });

  it("lists a role once when it is held on two projects", () => {
    const h: MemberHistory = { projects: [pa("Evergreen", "26F"), pa("Ripple", "26F")], core: [] };
    expect(currentRoleText(h, NOW)).toBe("26F: Developer (P2)");
  });

  it("ignores a term that has not started yet", () => {
    const h: MemberHistory = {
      projects: [pa("Evergreen", "26F", "Developer", "P1"), pa("Ripple", "27W", "Developer", "P2")],
      core: [],
    };
    expect(currentRoleText(h, NOW)).toBe("26F: Developer (P1)");
  });

  it("is blank when the member is only staffed for a future term", () => {
    expect(currentRoleText({ projects: [pa("Ripple", "27W")], core: [] }, NOW)).toBe("");
  });

  it("reads an untitled Core assignment as Core and skips legacy domains", () => {
    const h: MemberHistory = {
      projects: [pa("Old App", "26F", "Legacy", "P1", "domain_legacy")],
      core: [ca("26F")],
    };
    expect(currentRoleText(h, NOW)).toBe("26F: Core");
  });
});

describe("parseMemberColumns", () => {
  it("keeps known columns in display order and drops anything else", () => {
    expect(parseMemberColumns(new URLSearchParams("member=currentRole,nope,projectHistory"))).toEqual([
      "projectHistory",
      "currentRole",
    ]);
  });

  it("is empty without the param", () => {
    expect(parseMemberColumns(new URLSearchParams(""))).toEqual([]);
  });
});
