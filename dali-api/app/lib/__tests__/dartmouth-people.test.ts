import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/dartmouth-jwt", () => ({
  getDartmouthJwt: vi.fn().mockResolvedValue("test-jwt"),
}));

import {
  peopleByNetId,
  parseDepartmentClass,
  isGraduateProgramClass,
  graduateProgramLabel,
} from "~/lib/dartmouth-people";

describe("parseDepartmentClass", () => {
  it("parses apostrophe-prefixed two-digit class years", () => {
    expect(parseDepartmentClass("'27")).toBe(2027);
    expect(parseDepartmentClass("'00")).toBe(2000);
    expect(parseDepartmentClass("'89")).toBe(2089);
    expect(parseDepartmentClass("'99")).toBe(1999);
    expect(parseDepartmentClass(" '26 ")).toBe(2026);
  });

  it("returns null for department names and junk", () => {
    expect(parseDepartmentClass("Computer Science")).toBeNull();
    expect(parseDepartmentClass("27")).toBeNull();
    expect(parseDepartmentClass("'275")).toBeNull();
    expect(parseDepartmentClass("")).toBeNull();
    expect(parseDepartmentClass(null)).toBeNull();
    expect(parseDepartmentClass(undefined)).toBeNull();
  });
});

describe("isGraduateProgramClass", () => {
  it("is true for grad/professional program codes", () => {
    expect(isGraduateProgramClass("TH")).toBe(true); // Thayer
    expect(isGraduateProgramClass("GR")).toBe(true); // Guarini
    expect(isGraduateProgramClass("DM")).toBe(true); // Geisel
    expect(isGraduateProgramClass("TU27")).toBe(true); // Tuck (embedded year)
  });

  it("is false for undergrad class years", () => {
    expect(isGraduateProgramClass("'27")).toBe(false);
    expect(isGraduateProgramClass("'26")).toBe(false);
    expect(isGraduateProgramClass(" '25 ")).toBe(false);
  });

  it("is false for empty / missing values", () => {
    expect(isGraduateProgramClass("")).toBe(false);
    expect(isGraduateProgramClass(null)).toBe(false);
    expect(isGraduateProgramClass(undefined)).toBe(false);
  });
});

describe("graduateProgramLabel", () => {
  it("maps known program codes (incl. embedded year) to school labels", () => {
    expect(graduateProgramLabel("TH")).toBe("Thayer");
    expect(graduateProgramLabel("GR")).toBe("Guarini");
    expect(graduateProgramLabel("DM")).toBe("Geisel");
    expect(graduateProgramLabel("TU27")).toBe("Tuck");
  });

  it("returns null for class years, unknown codes, employees, and empty", () => {
    expect(graduateProgramLabel("'27")).toBeNull();
    expect(graduateProgramLabel("XYZ")).toBeNull();
    expect(graduateProgramLabel("Computer Science")).toBeNull();
    expect(graduateProgramLabel("")).toBeNull();
    expect(graduateProgramLabel(null)).toBeNull();
    expect(graduateProgramLabel(undefined)).toBeNull();
  });
});

describe("peopleByNetId", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockPerson(body: unknown, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status }),
    );
  }

  it("sends the JWT as a Bearer token to the person URL", async () => {
    mockPerson({ dartmouth_affiliation: "DART", affiliations: [] });
    await peopleByNetId("f006v43");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.dartmouth.edu/api/people/f006v43");
    expect((call[1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer test-jwt",
    });
  });

  // The four shapes below are real (anonymized) records observed 2026-07-06,
  // three weeks after Commencement — see alumni_plan.md.

  it("current student: Student affiliation, class year parsed", async () => {
    mockPerson({
      dartmouth_affiliation: "DART",
      affiliations: [{ name: "Student" }],
      department_class: "'27",
    });
    expect(await peopleByNetId("current")).toEqual({
      dartmouthAffiliation: "DART",
      isAlum: false,
      isStudent: true,
      classYear: 2027,
      departmentClass: "'27",
    });
  });

  it("enrolled +1: classYear past but no Alum affiliation", async () => {
    mockPerson({
      dartmouth_affiliation: "DART",
      affiliations: [{ name: "Student" }],
      department_class: "'26",
    });
    expect(await peopleByNetId("plusone")).toEqual({
      dartmouthAffiliation: "DART",
      isAlum: false,
      isStudent: true,
      classYear: 2026,
      departmentClass: "'26",
    });
  });

  it("fresh grad: Alum appears while Student lingers and IDM still says DART", async () => {
    mockPerson({
      dartmouth_affiliation: "DART",
      affiliations: [{ name: "Alum" }, { name: "Student" }],
      department_class: "'26",
    });
    expect(await peopleByNetId("grad")).toEqual({
      dartmouthAffiliation: "DART",
      isAlum: true,
      isStudent: true,
      classYear: 2026,
      departmentClass: "'26",
    });
  });

  it("enrolled grad student: Alum + Student with a program-code department_class", async () => {
    mockPerson({
      dartmouth_affiliation: "DART",
      affiliations: [{ name: "Alum" }, { name: "Student" }],
      department_class: "GR",
    });
    expect(await peopleByNetId("gradstudent")).toEqual({
      dartmouthAffiliation: "DART",
      isAlum: true,
      isStudent: true,
      classYear: null,
      departmentClass: "GR",
    });
  });

  it("long-graduated: IDM flipped to ALUMNI", async () => {
    mockPerson({
      dartmouth_affiliation: "ALUMNI",
      affiliations: [{ name: "Alum" }],
      department_class: "'20",
    });
    expect(await peopleByNetId("old-grad")).toEqual({
      dartmouthAffiliation: "ALUMNI",
      isAlum: true,
      isStudent: false,
      classYear: 2020,
      departmentClass: "'20",
    });
  });

  it("employee: department name is not a class year", async () => {
    mockPerson({
      dartmouth_affiliation: "DART",
      affiliations: [{ name: "Staff" }],
      department_class: "Computer Science",
    });
    expect(await peopleByNetId("staff")).toEqual({
      dartmouthAffiliation: "DART",
      isAlum: false,
      isStudent: false,
      classYear: null,
      departmentClass: "Computer Science",
    });
  });

  it("tolerates missing affiliations and department_class", async () => {
    mockPerson({ dartmouth_affiliation: "SPON" });
    expect(await peopleByNetId("spon")).toEqual({
      dartmouthAffiliation: "SPON",
      isAlum: false,
      isStudent: false,
      classYear: null,
      departmentClass: null,
    });
  });

  it("returns null on 404 (not a valid identity)", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    expect(await peopleByNetId("ghost")).toBeNull();
  });

  it("throws on non-OK, non-404 responses", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("nope", { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(peopleByNetId("x")).rejects.toThrow(/503/);
  });

  it("URL-encodes the netId", async () => {
    mockPerson({ affiliations: [] });
    await peopleByNetId("a/b");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.dartmouth.edu/api/people/a%2Fb");
  });
});
