import { describe, expect, it } from "vitest";
import {
  ROLE_FILTERS,
  accessIntent,
  accessOf,
  coreLabel,
  domainRoster,
  matchesQuery,
  mergeMemberships,
  type AccessMember,
  type LabAccess,
} from "~/core/lib/access";

const member = (over: Partial<AccessMember> = {}): AccessMember => ({
  id: "m",
  name: "Maya Patel",
  email: "maya@dali.dartmouth.edu",
  photoUrl: null,
  isLabMember: true,
  isAlumni: false,
  access: "none",
  envAdmin: false,
  coreTitles: [],
  domains: [],
  otherLeads: [],
  ...over,
});

describe("accessOf", () => {
  it("reads Staff over Admin, since Staff implies Admin", () => {
    expect(accessOf({ isAdmin: false, isStaff: false })).toBe("none");
    expect(accessOf({ isAdmin: true, isStaff: false })).toBe("admin");
    expect(accessOf({ isAdmin: true, isStaff: true })).toBe("staff");
  });
});

describe("accessIntent", () => {
  const cases: [LabAccess, LabAccess, ReturnType<typeof accessIntent>][] = [
    ["none", "admin", { intent: "set-admin", value: "true" }],
    ["none", "staff", { intent: "set-staff", value: "true" }],
    ["admin", "staff", { intent: "set-staff", value: "true" }],
    // Un-marking Staff keeps Admin on the server.
    ["staff", "admin", { intent: "set-staff", value: "false" }],
    ["admin", "none", { intent: "set-admin", value: "false" }],
    ["staff", "none", { intent: "set-admin", value: "false" }],
    ["admin", "admin", null],
  ];
  it.each(cases)("moves %s to %s with one existing intent", (from, to, expected) => {
    expect(accessIntent(from, to)).toEqual(expected);
  });
});

describe("ROLE_FILTERS", () => {
  const lead = member({ domains: [{ domainId: "d", level: "P3", eligibilityId: "e", leadAssignmentId: "l" }] });
  const core = member({ coreTitles: [{ id: "c", title: "President" }] });
  const admin = member({ access: "admin" });
  const staff = member({ access: "staff" });
  const plain = member({ domains: [{ domainId: "d", level: "P1", eligibilityId: "e", leadAssignmentId: null }] });

  it("sorts people into Admin & staff, Core and Domain leads", () => {
    const all = [lead, core, admin, staff, plain];
    expect(all.filter(ROLE_FILTERS.all)).toHaveLength(5);
    expect(all.filter(ROLE_FILTERS.admins)).toEqual([admin, staff]);
    expect(all.filter(ROLE_FILTERS.core)).toEqual([core]);
    expect(all.filter(ROLE_FILTERS.leads)).toEqual([lead]);
  });
});

describe("matchesQuery", () => {
  it("matches name, email and Core title, ignoring case and spacing", () => {
    const m = member({ coreTitles: [{ id: "c", title: "Outreach lead" }] });
    expect(matchesQuery(m, "")).toBe(true);
    expect(matchesQuery(m, "  MAYA ")).toBe(true);
    expect(matchesQuery(m, "dali.dartmouth")).toBe(true);
    expect(matchesQuery(m, "outreach")).toBe(true);
    expect(matchesQuery(m, "hiring")).toBe(false);
  });
});

describe("coreLabel", () => {
  it("names an untitled Core seat plainly", () => {
    expect(coreLabel([{ title: "President" }, { title: null }])).toBe("President, Core");
  });
});

describe("mergeMemberships", () => {
  it("joins levels and this term's lead roles into one row per domain", () => {
    expect(
      mergeMemberships(
        [
          { id: "e1", domainId: "eng", level: "P3" },
          { id: "e2", domainId: "des", level: "P1" },
        ],
        [
          { id: "l1", domainId: "eng" },
          { id: "l2", domainId: "pm" },
        ],
      ),
    ).toEqual([
      { domainId: "eng", level: "P3", eligibilityId: "e1", leadAssignmentId: "l1" },
      { domainId: "des", level: "P1", eligibilityId: "e2", leadAssignmentId: null },
      // A lead with no level still shows, so the role can be seen and removed.
      { domainId: "pm", level: null, eligibilityId: null, leadAssignmentId: "l2" },
    ]);
  });
});

describe("domainRoster", () => {
  it("counts current members only, with leads and a per-level breakdown", () => {
    const eng = (level: "P1" | "P2" | "P3", lead = false) => [
      { domainId: "eng", level, eligibilityId: `e-${level}`, leadAssignmentId: lead ? "l" : null },
    ];
    const members = [
      member({ id: "a", domains: eng("P3", true) }),
      member({ id: "b", domains: eng("P1") }),
      member({ id: "c", domains: eng("P1"), isAlumni: true }),
      member({ id: "d" }),
    ];
    const r = domainRoster(members, "eng");
    expect(r.people.map((m) => m.id)).toEqual(["a", "b"]);
    expect(r.leads.map((m) => m.id)).toEqual(["a"]);
    expect(r.byLevel).toEqual([
      { level: "P1", count: 1 },
      { level: "P2", count: 0 },
      { level: "P3", count: 1 },
    ]);
  });
});
