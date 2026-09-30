import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/dartmouth-jwt", () => ({
  getDartmouthJwt: vi.fn().mockResolvedValue("test-jwt"),
}));

import {
  peopleByNetId,
  findNetIdByAddress,
  DartmouthPeopleError,
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
    await peopleByNetId("d99999z");

    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://api.dartmouth.edu/api/people/d99999z");
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
      email: null,
      name: null,
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
    it("returns the name-form address at base scope", async () => {
      // This is the field that removes the need for the Email Addresses API and
      // its Advancement scope: the address a student actually uses, keyed by the
      // netID we already hold, from an endpoint we are already authorized for.
      mockPerson({
        dartmouth_affiliation: "DART",
        affiliations: [{ name: "Student" }],
        department_class: "'27",
        email: "Alex.T.Rivera.27@Dartmouth.edu",
        name: "Alex T Rivera",
      });

      const person = await peopleByNetId("d99999z");
      expect(person?.email).toBe("alex.t.rivera.27@dartmouth.edu");
      expect(person?.name).toBe("Alex T Rivera");
    });

    it("reports a missing address as null rather than inventing one", async () => {
      // Synthesizing netid@dartmouth.edu to fill the gap is precisely the habit
      // that made CAS-era rows unreachable.
      mockPerson({
        dartmouth_affiliation: "DART",
        affiliations: [{ name: "Student" }],
        department_class: "'27",
      });

      expect((await peopleByNetId("d99999z"))?.email).toBeNull();
    });
});

describe("findNetIdByAddress", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  function respond(body: unknown, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  }

  it("resolves a proven address to its owner", async () => {
    respond([
      {
        netid: "d99999z",
        name: "Alex T Rivera",
        email: "Alex.T.Rivera.27@dartmouth.edu",
        affiliations: [{ name: "Student" }],
      },
    ]);

    expect(await findNetIdByAddress("alex.t.rivera.27@dartmouth.edu")).toBe("d99999z");
  });

  it("returns null rather than a stranger when the filter is ignored", async () => {
    // Observed against the live API on 2026-09-30: an unrecognised filter
    // parameter is NOT rejected. The request answers 200 with an UNFILTERED
    // list, so the first record is an unrelated person. Taking rows[0] would
    // bind someone else's netID — which is their payroll identity — onto this
    // account. The address on the record has to match what was asked for.
    respond([
      {
        netid: "d1035k5",
        name: "Someone Else",
        email: "d1035k5@dartmouth.edu",
        affiliations: [{ name: "Staff" }],
      },
    ]);

    expect(await findNetIdByAddress("alex.t.rivera.27@dartmouth.edu")).toBeNull();
  });

  it("picks the matching record out of an unfiltered list", async () => {
    respond([
      { netid: "d1035k5", email: "d1035k5@dartmouth.edu" },
      { netid: "d99999z", email: "alex.t.rivera.27@dartmouth.edu" },
    ]);

    expect(await findNetIdByAddress("alex.t.rivera.27@dartmouth.edu")).toBe("d99999z");
  });

  it("matches case-insensitively", async () => {
    respond([{ netid: "d99999z", email: "Alex.T.Rivera.27@Dartmouth.EDU" }]);

    expect(await findNetIdByAddress("  ALEX.T.RIVERA.27@dartmouth.edu ")).toBe("d99999z");
  });

  it("returns null for an empty result", async () => {
    respond([]);
    expect(await findNetIdByAddress("nobody@dartmouth.edu")).toBeNull();
  });

  it("surfaces a failed lookup instead of reporting no such person", async () => {
    respond("", 503);
    await expect(findNetIdByAddress("alex.t.rivera.27@dartmouth.edu")).rejects.toBeInstanceOf(
      DartmouthPeopleError,
    );
  });
});
