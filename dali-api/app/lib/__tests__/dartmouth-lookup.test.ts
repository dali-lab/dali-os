import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ~/lib/dartmouth-people only for peopleByNetId — keep the real
// parseDepartmentClass and isGraduateProgramClass so hasStudentSignal
// exercises actual logic.
vi.mock("~/lib/dartmouth-people", async (importActual) => {
  const actual =
    await importActual<typeof import("~/lib/dartmouth-people")>();
  return {
    ...actual,
    peopleByNetId: vi.fn(),
  };
});

import { peopleByNetId } from "~/lib/dartmouth-people";
import {
  searchDirectoryByName,
  bindNetIdByEmail,
  findDirectoryByNetId,
  queriesFromDartmouthEmail,
  DirectoryLookupError,
  hasStudentSignal,
  classifyDirectoryMatch,
  validateSelfEnteredNetId,
} from "~/lib/dartmouth-lookup";

// ─────────────────────────────────────────────────────────────────────────────
// searchDirectoryByName
// ─────────────────────────────────────────────────────────────────────────────

describe("searchDirectoryByName", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  // A fresh Response per call: a Response body can only be read once, and
  // bindNetIdByEmail may issue several queries before it finds a mail match.
  function mockDirectory(body: unknown, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  }

  it("parses a multi-record array and normalises netId/mail to lowercase", async () => {
    mockDirectory([
      {
        uid: "d99999z",
        mail: "Jane.Doe@Dartmouth.EDU",
        eduPersonPrimaryAffiliation: "Student",
        dcDeptclass: "'27",
      },
      {
        uid: "g001abc",
        mail: "john.smith@dartmouth.edu",
        eduPersonPrimaryAffiliation: "Staff",
        dcDeptclass: "ArtSci DALI Lab",
      },
    ]);

    const results = await searchDirectoryByName("Jane Doe");
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      netId: "d99999z",
      mail: "jane.doe@dartmouth.edu",
      affiliation: "Student",
      departmentClass: "'27",
      classYear: 2027,
    });
    expect(results[1]).toEqual({
      netId: "g001abc",
      mail: "john.smith@dartmouth.edu",
      affiliation: "Staff",
      departmentClass: "ArtSci DALI Lab",
      classYear: null,
    });
  });

  it("skips records that have no uid", async () => {
    mockDirectory([
      { mail: "nobody@dartmouth.edu" },
      { uid: "", mail: "empty@dartmouth.edu" },
      { uid: "realnetid", mail: "real@dartmouth.edu" },
    ]);
    const results = await searchDirectoryByName("Nobody");
    expect(results).toHaveLength(1);
    expect(results[0].netId).toBe("realnetid");
  });

  it("accepts the { users: [...] } envelope", async () => {
    mockDirectory({
      users: [
        {
          uid: "u001",
          mail: "u001@dartmouth.edu",
          eduPersonPrimaryAffiliation: "Faculty",
        },
      ],
    });
    const results = await searchDirectoryByName("Prof Doe");
    expect(results).toHaveLength(1);
    expect(results[0].netId).toBe("u001");
  });

  it("accepts the { results: [...] } envelope", async () => {
    mockDirectory({
      results: [
        {
          uid: "r002",
          mail: "r002@dartmouth.edu",
          eduPersonPrimaryAffiliation: "Student",
          dcDeptclass: "'28",
        },
      ],
    });
    const results = await searchDirectoryByName("Robin Smith");
    expect(results).toHaveLength(1);
    expect(results[0].netId).toBe("r002");
    expect(results[0].classYear).toBe(2028);
  });

  it("returns [] and does NOT call fetch for a blank name", async () => {
    const results = await searchDirectoryByName("   ");
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns [] and does NOT call fetch for an empty string", async () => {
    const results = await searchDirectoryByName("");
    expect(results).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns [] on 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("not found", { status: 404 }),
    );
    expect(await searchDirectoryByName("Ghost Person")).toEqual([]);
  });

  it("throws on a non-OK, non-404 response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("server error", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    await expect(searchDirectoryByName("Boom")).rejects.toThrow(/500/);
  });

  it("URL-encodes the query string", async () => {
    mockDirectory([]);
    await searchDirectoryByName("O'Brien, Pat");
    const call = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain(encodeURIComponent("O'Brien, Pat"));
  });

  it("tolerates records with absent optional fields", async () => {
    mockDirectory([{ uid: "minimal" }]);
    const results = await searchDirectoryByName("Minimal");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      netId: "minimal",
      mail: null,
      affiliation: null,
      departmentClass: null,
      classYear: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bindNetIdByEmail
// ─────────────────────────────────────────────────────────────────────────────

describe("bindNetIdByEmail", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  // A fresh Response per call: a Response body can only be read once, and
  // bindNetIdByEmail may issue several queries before it finds a mail match.
  function mockDirectory(body: unknown, status = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify(body), { status }),
    );
  }

  it("binds on an exact mail match (case-insensitive: verified mixed-case matches lowercase record)", async () => {
    mockDirectory([
      { uid: "jdoe26", mail: "jane.doe@dartmouth.edu" },
      { uid: "jsmith", mail: "john.smith@dartmouth.edu" },
    ]);
    // Verified email arrives with mixed case (e.g. from Google OAuth).
    const match = await bindNetIdByEmail("Jane Doe", "Jane.Doe@Dartmouth.edu");
    expect(match).not.toBeNull();
    expect(match!.netId).toBe("jdoe26");
  });

  it("returns null when a name-matching record exists but no mail matches", async () => {
    // Record has no mail field — must not bind on name alone.
    mockDirectory([{ uid: "jdoe26" }]);
    const match = await bindNetIdByEmail("Jane Doe", "jane.doe@dartmouth.edu");
    expect(match).toBeNull();
  });

  it("returns null when no results come back at all", async () => {
    mockDirectory([]);
    const match = await bindNetIdByEmail("Nobody", "nobody@dartmouth.edu");
    expect(match).toBeNull();
  });

  it("returns null when the email does not match any record mail", async () => {
    mockDirectory([
      { uid: "other", mail: "other.person@dartmouth.edu" },
    ]);
    const match = await bindNetIdByEmail("Jane Doe", "jane.doe@dartmouth.edu");
    expect(match).toBeNull();
  });

  it("returns the first matching record when multiple records share a mail (edge case)", async () => {
    mockDirectory([
      { uid: "first", mail: "jane.doe@dartmouth.edu" },
      { uid: "second", mail: "jane.doe@dartmouth.edu" },
    ]);
    const match = await bindNetIdByEmail("Jane Doe", "jane.doe@dartmouth.edu");
    expect(match!.netId).toBe("first");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasStudentSignal
// ─────────────────────────────────────────────────────────────────────────────

describe("hasStudentSignal", () => {
  it('returns true when affiliation is "Student"', () => {
    expect(
      hasStudentSignal({ affiliation: "Student", departmentClass: null }),
    ).toBe(true);
  });

  it("returns true for an undergrad class year in dcDeptclass", () => {
    expect(
      hasStudentSignal({ affiliation: null, departmentClass: "'27" }),
    ).toBe(true);
  });

  it("returns true for grad program codes: GR, TH, DM, TU27", () => {
    for (const code of ["GR", "TH", "DM", "TU27"]) {
      expect(
        hasStudentSignal({ affiliation: null, departmentClass: code }),
      ).toBe(true);
    }
  });

  it("returns false for Staff affiliation with an employee department name", () => {
    expect(
      hasStudentSignal({
        affiliation: "Staff",
        departmentClass: "ArtSci DALI Lab",
      }),
    ).toBe(false);
  });

  it("returns false for Faculty affiliation with an employee department name", () => {
    expect(
      hasStudentSignal({
        affiliation: "Faculty",
        departmentClass: "Computer Science",
      }),
    ).toBe(false);
  });

  it("returns false when both fields are null", () => {
    expect(hasStudentSignal({ affiliation: null, departmentClass: null })).toBe(
      false,
    );
  });

  // Key edge case: employed grad student whose affiliation reads "Staff" but
  // their dcDeptclass is a grad program code. We want this to read as a student.
  it("returns true for an employed grad student (affiliation Staff, departmentClass GR)", () => {
    expect(
      hasStudentSignal({ affiliation: "Staff", departmentClass: "GR" }),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyDirectoryMatch
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyDirectoryMatch", () => {
  it('classifies a Student-affiliation record as "dartmouth-student"', () => {
    expect(
      classifyDirectoryMatch({ affiliation: "Student", departmentClass: "'27" }),
    ).toBe("dartmouth-student");
  });

  it('classifies a Staff/Faculty record with a dept name as "dartmouth-nonstudent"', () => {
    expect(
      classifyDirectoryMatch({
        affiliation: "Staff",
        departmentClass: "Thayer School of Engineering",
      }),
    ).toBe("dartmouth-nonstudent");
  });

  it('classifies a grad-program-code record as "dartmouth-student" even with null affiliation', () => {
    expect(
      classifyDirectoryMatch({ affiliation: null, departmentClass: "TH" }),
    ).toBe("dartmouth-student");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSelfEnteredNetId
// ─────────────────────────────────────────────────────────────────────────────

describe("validateSelfEnteredNetId", () => {
  beforeEach(() => {
    vi.mocked(peopleByNetId).mockReset();
  });

  it("returns the people result when the netID exists", async () => {
    const fakeResult = {
      dartmouthAffiliation: "DART",
      isAlum: false,
      isStudent: true,
      classYear: 2027,
      departmentClass: "'27",
    };
    vi.mocked(peopleByNetId).mockResolvedValue(fakeResult);

    const result = await validateSelfEnteredNetId("d99999z");
    expect(result).toEqual(fakeResult);
    // Normalises netId to lowercase before passing to peopleByNetId.
    expect(vi.mocked(peopleByNetId)).toHaveBeenCalledWith("d99999z");
  });

  it("returns null when peopleByNetId returns null (unknown netID)", async () => {
    vi.mocked(peopleByNetId).mockResolvedValue(null);
    const result = await validateSelfEnteredNetId("ghost");
    expect(result).toBeNull();
  });

  it("trims and lowercases the input netId", async () => {
    vi.mocked(peopleByNetId).mockResolvedValue(null);
    await validateSelfEnteredNetId("  TRIMME  ");
    expect(vi.mocked(peopleByNetId)).toHaveBeenCalledWith("trimme");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live payload + both lookup directions
// ─────────────────────────────────────────────────────────────────────────────

// Verbatim response from lookup.dartmouth.edu/api/search?query=alex%20rivera
// (2026-09-30). Kept exact: this file is the contract for the wire format, and
// the parser's field names were assumptions until this landed.
const LIVE_PAYLOAD = {
  status: "200",
  users: [
    {
      uid: "d99999z",
      dcAffiliation: "DART",
      eduPersonPrimaryAffiliation: "Student",
      dcHinmanaddr: "HB 0000",
      mail: "alex.t.rivera.27@dartmouth.edu",
      displayName: "Alex T Rivera",
      dcDeptclass: "'27",
    },
  ],
  truncated: false,
};

describe("live /api/search payload", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof global.fetch;
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response(JSON.stringify(LIVE_PAYLOAD), { status: 200 }),
    );
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("parses the real envelope and lowercases the mixed-case mail", async () => {
    expect(await searchDirectoryByName("alex rivera")).toEqual([
      {
        netId: "d99999z",
        mail: "alex.t.rivera.27@dartmouth.edu",
        affiliation: "Student",
        departmentClass: "'27",
        classYear: 2027,
      },
    ]);
  });

  it("binds a netId from the name-form address without being told the name", async () => {
    // The query is derived from the address itself, so a user who never types
    // their name (or types a nickname) still gets a netID captured.
    const match = await bindNetIdByEmail("", "alex.t.rivera.27@dartmouth.edu");
    expect(match?.netId).toBe("d99999z");
  });

  it("does not bind from the synthesized netid-form address", async () => {
    // The directory publishes only the name-form as `mail`. This is exactly the
    // mismatch that locked CAS-era students out: the address we stored is not
    // the address anyone uses.
    expect(await bindNetIdByEmail("alex rivera", "d99999z@dartmouth.edu")).toBeNull();
  });

  it("resolves netId -> mail, the direction that repairs an existing row", async () => {
    expect((await findDirectoryByNetId("d99999z"))?.mail).toBe(
      "alex.t.rivera.27@dartmouth.edu",
    );
  });

  it("refuses a record whose uid is not the netId asked about", async () => {
    expect(await findDirectoryByNetId("someoneelse")).toBeNull();
  });
});

describe("queriesFromDartmouthEmail", () => {
  it("derives narrowest-first name queries from the local part", () => {
    expect(queriesFromDartmouthEmail("alex.t.rivera.27@dartmouth.edu")).toEqual([
      "kiran p jones",
      "alex rivera",
      "jones",
    ]);
  });

  it("handles an address with no class year", () => {
    expect(queriesFromDartmouthEmail("jane.doe@dartmouth.edu")).toEqual([
      "jane doe",
      "doe",
    ]);
  });

  it("keeps a multi-word surname reachable", () => {
    expect(queriesFromDartmouthEmail("maria.de.la.cruz.28@dartmouth.edu")).toEqual([
      "maria de la cruz",
      "maria cruz",
      "cruz",
    ]);
  });

  it("treats a netid-form address as a single uid query", () => {
    expect(queriesFromDartmouthEmail("d99999z@dartmouth.edu")).toEqual(["d99999z"]);
  });

  it("returns nothing for an address with an empty local part", () => {
    expect(queriesFromDartmouthEmail("@dartmouth.edu")).toEqual([]);
  });
});

describe("lookup failures are distinguishable from misses", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof global.fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.clearAllMocks();
  });

  it("treats an SSO gate answering 200 with HTML as an error, not an empty result", async () => {
    // A 302 to a login page is followed by fetch and arrives as HTML. Returning
    // [] here would read as "no such person" and silently skip netID capture.
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("<html>login</html>", { status: 200 }),
    );
    await expect(searchDirectoryByName("alex rivera")).rejects.toBeInstanceOf(
      DirectoryLookupError,
    );
  });

  it("surfaces a transport failure rather than swallowing it", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(searchDirectoryByName("alex rivera")).rejects.toBeInstanceOf(
      DirectoryLookupError,
    );
  });

  it("still reports a genuine 404 as no match", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      async () => new Response("", { status: 404 }),
    );
    expect(await searchDirectoryByName("nobody at all")).toEqual([]);
  });
});
