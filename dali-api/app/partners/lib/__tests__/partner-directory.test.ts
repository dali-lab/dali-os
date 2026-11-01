import { describe, it, expect } from "vitest";
import {
  DEFAULT_DIRECTORY_SORT,
  DIRECTORY_ROW_CLASS,
  buildDirectoryRows,
  directoryExportHref,
  directoryFiltersFromParams,
  directoryRowCells,
  directoryRowHref,
  filterDirectoryRows,
  isDirectorySort,
  nextDirectorySort,
  orgInitials,
  partnerDirectoryCsvRows,
  sortDirectoryRows,
} from "../partner-directory";
import type {
  PartnerContactDirectoryRow,
  PartnerDirectoryRow,
  PartnerOrgDirectoryRow,
} from "../partner-directory";

const org = (over: Partial<PartnerOrgDirectoryRow>): PartnerOrgDirectoryRow => ({
  id: over.name ?? "o",
  name: "Acme",
  logoUrl: null,
  website: null,
  isIndividual: false,
  type: "Company",
  status: "Active",
  memberCount: 0,
  activeProjectCount: 0,
  totalProjectCount: 0,
  lastActivityAt: null,
  ...over,
});

const contact = (over: Partial<PartnerContactDirectoryRow>): PartnerContactDirectoryRow => ({
  id: over.name ?? "c",
  name: "Jo",
  email: null,
  title: null,
  affiliation: null,
  orgs: [],
  applicationCount: 0,
  lastActivityAt: null,
  ...over,
});

describe("DIRECTORY_ROW_CLASS", () => {
  it("contains the stretched row link with a transform, which WKWebView honors on a <tr>", () => {
    expect(DIRECTORY_ROW_CLASS.split(" ")).toContain("[transform:translate(0)]");
  });
});

describe("buildDirectoryRows", () => {
  const orgs = [
    org({ id: "org-acme", name: "Acme", website: "https://acme.com", memberCount: 2 }),
    org({ id: "org-solo", name: "Sam Solo", isIndividual: true, type: null, status: "Prospect" }),
  ];
  const contacts = [
    contact({
      id: "c-jo",
      name: "Jo",
      email: "jo@acme.com",
      title: "CTO",
      orgs: [{ id: "org-acme", name: "Acme" }],
      applicationCount: 2,
    }),
    contact({
      id: "c-sam",
      name: "Sam Solo",
      email: "sam@example.com",
      title: "Advisor",
      orgs: [{ id: "org-solo", name: "Sam Solo" }],
      applicationCount: 1,
    }),
    contact({ id: "c-free", name: "Free Agent" }),
  ];

  it("keeps every org, and every contact not already represented by an individual org", () => {
    const rows = buildDirectoryRows(orgs, contacts);
    expect(rows.map((r) => `${r.kind}:${r.name}`)).toEqual([
      "org:Acme",
      "individual:Sam Solo",
      "person:Jo",
      "person:Free Agent",
    ]);
  });

  it("enriches an individual row with its mirror contact's email, title and applications", () => {
    const rows = buildDirectoryRows(orgs, contacts);
    const solo = rows.find((r) => r.kind === "individual")!;
    expect(solo.email).toBe("sam@example.com");
    expect(solo.title).toBe("Advisor");
    expect(solo.applicationCount).toBe(1);
  });

  it("carries org names onto person rows", () => {
    const rows = buildDirectoryRows(orgs, contacts);
    const jo = rows.find((r) => r.name === "Jo")!;
    expect(jo.orgNames).toEqual(["Acme"]);
    expect(jo.status).toBeNull();
  });
});

describe("directoryRowHref", () => {
  it("routes people to the contact page and orgs/individuals to the org page", () => {
    expect(directoryRowHref({ kind: "person", id: "c1" })).toBe("/core/partners/contacts/c1");
    expect(directoryRowHref({ kind: "org", id: "o1" })).toBe("/core/partners/orgs/o1");
    expect(directoryRowHref({ kind: "individual", id: "o2" })).toBe("/core/partners/orgs/o2");
  });
});

function unified(): PartnerDirectoryRow[] {
  return buildDirectoryRows(
    [
      org({ id: "org-acme", name: "Acme", type: "Company", status: "Active" }),
      org({ id: "org-lab", name: "Beta Lab", type: "Nonprofit", status: "Dormant" }),
      org({ id: "org-solo", name: "Sam Solo", isIndividual: true, type: null, status: "Prospect" }),
    ],
    [
      contact({
        id: "c-jo",
        name: "Jo",
        email: "jo@acme.com",
        title: "CTO",
        orgs: [{ id: "org-acme", name: "Acme" }],
      }),
      contact({ id: "c-sam", name: "Sam Solo", orgs: [{ id: "org-solo", name: "Sam Solo" }] }),
      contact({ id: "c-free", name: "Free Agent" }),
    ],
  );
}

describe("filterDirectoryRows", () => {
  it("matches the query against name, email, title and org names", () => {
    const rows = unified();
    expect(filterDirectoryRows(rows, "lab").map((r) => r.name)).toEqual(["Beta Lab"]);
    expect(filterDirectoryRows(rows, "jo@acme").map((r) => r.name)).toEqual(["Jo"]);
    expect(filterDirectoryRows(rows, "cto").map((r) => r.name)).toEqual(["Jo"]);
    // An org-name query finds the org and its people.
    expect(filterDirectoryRows(rows, "acme").map((r) => r.name)).toEqual(["Acme", "Jo"]);
    expect(filterDirectoryRows(rows, "  ")).toHaveLength(5);
  });

  it("applies kind, type, status and org column filters", () => {
    const rows = unified();
    expect(
      filterDirectoryRows(rows, "", [{ columnKey: "kind", values: ["Person"] }]).map((r) => r.name),
    ).toEqual(["Jo", "Free Agent"]);
    expect(
      filterDirectoryRows(rows, "", [{ columnKey: "kind", values: ["Organization", "Individual"] }]),
    ).toHaveLength(3);
    expect(
      filterDirectoryRows(rows, "", [{ columnKey: "type", values: ["Nonprofit"] }]).map(
        (r) => r.name,
      ),
    ).toEqual(["Beta Lab"]);
    expect(
      filterDirectoryRows(rows, "", [{ columnKey: "status", values: ["Prospect"] }]).map(
        (r) => r.name,
      ),
    ).toEqual(["Sam Solo"]);
    expect(
      filterDirectoryRows(rows, "", [{ columnKey: "org", values: ["Acme"] }]).map((r) => r.name),
    ).toEqual(["Acme", "Jo"]);
  });

  it("combines the query with filters", () => {
    const rows = unified();
    expect(
      filterDirectoryRows(rows, "sam", [{ columnKey: "kind", values: ["Person"] }]),
    ).toHaveLength(0);
  });
});

describe("directoryRowCells", () => {
  it("gives org rows their own name in the org cell, people their org names", () => {
    const rows = unified();
    expect(directoryRowCells(rows.find((r) => r.name === "Acme")!)).toEqual({
      kind: "Organization",
      type: "Company",
      status: "Active",
      org: ["Acme"],
    });
    expect(directoryRowCells(rows.find((r) => r.name === "Jo")!)).toEqual({
      kind: "Person",
      type: [],
      status: [],
      org: ["Acme"],
    });
    expect(directoryRowCells(rows.find((r) => r.kind === "individual")!).org).toEqual([]);
  });
});

describe("partnerDirectoryCsvRows", () => {
  it("builds a header row plus one row per record, blank where a field doesn't apply", () => {
    const rows = partnerDirectoryCsvRows(unified());
    expect(rows[0]).toEqual([
      "Name",
      "Kind",
      "Type",
      "Email",
      "Title",
      "Website",
      "Organizations",
      "Status",
      "People",
      "Active projects",
      "Total projects",
      "Applications",
      "Last activity",
    ]);
    const acme = rows.find((r) => r[0] === "Acme")!;
    expect(acme.slice(1, 3)).toEqual(["Organization", "Company"]);
    const jo = rows.find((r) => r[0] === "Jo")!;
    expect(jo[1]).toBe("Person");
    expect(jo[6]).toBe("Acme");
    expect(jo[7]).toBe("");
    expect(jo[9]).toBe("");
  });
});

describe("directoryExportHref and directoryFiltersFromParams", () => {
  it("round-trips the query and column filters", () => {
    const href = directoryExportHref(" acme ", [
      { columnKey: "kind", values: ["Person"] },
      { columnKey: "type", values: ["Company", "Nonprofit"] },
      { columnKey: "ignored", values: ["x"] },
    ]);
    expect(href).toBe("/api/partner-directory.csv?q=acme&kind=Person&type=Company&type=Nonprofit");
    const params = new URL(href, "http://x").searchParams;
    expect(directoryFiltersFromParams(params)).toEqual([
      { columnKey: "kind", values: ["Person"] },
      { columnKey: "type", values: ["Company", "Nonprofit"] },
    ]);
  });

  it("drops the query string entirely when there is nothing to carry", () => {
    expect(directoryExportHref("", [])).toBe("/api/partner-directory.csv");
  });
});

describe("sortDirectoryRows", () => {
  const rows = [
    org({ name: "Beta", lastActivityAt: "2026-01-01T00:00:00.000Z" }),
    org({ name: "Alpha", lastActivityAt: "2026-03-01T00:00:00.000Z" }),
    org({ name: "Gamma", lastActivityAt: null }),
  ];

  it("defaults to newest activity first with no-activity rows last", () => {
    expect(sortDirectoryRows(rows, DEFAULT_DIRECTORY_SORT).map((r) => r.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
  });

  it("keeps no-activity rows last when activity is ascending", () => {
    expect(sortDirectoryRows(rows, { key: "activity", dir: "asc" }).map((r) => r.name)).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
    ]);
  });

  it("sorts by name both ways without mutating the input", () => {
    expect(sortDirectoryRows(rows, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(sortDirectoryRows(rows, { key: "name", dir: "desc" }).map((r) => r.name)).toEqual([
      "Gamma",
      "Beta",
      "Alpha",
    ]);
    expect(rows[0].name).toBe("Beta");
  });
});

describe("nextDirectorySort", () => {
  it("flips direction on the active column", () => {
    expect(nextDirectorySort({ key: "activity", dir: "desc" }, "activity")).toEqual({
      key: "activity",
      dir: "asc",
    });
  });

  it("starts a new column in its natural direction", () => {
    expect(nextDirectorySort({ key: "activity", dir: "desc" }, "name")).toEqual({
      key: "name",
      dir: "asc",
    });
    expect(nextDirectorySort({ key: "name", dir: "asc" }, "activity")).toEqual({
      key: "activity",
      dir: "desc",
    });
  });
});

describe("isDirectorySort", () => {
  it("accepts valid sorts and rejects junk", () => {
    expect(isDirectorySort({ key: "name", dir: "asc" })).toBe(true);
    expect(isDirectorySort({ key: "size", dir: "asc" })).toBe(false);
    expect(isDirectorySort(null)).toBe(false);
    expect(isDirectorySort("name")).toBe(false);
  });
});

describe("orgInitials", () => {
  it("uses two letters", () => {
    expect(orgInitials("Acme Corp")).toBe("AC");
    expect(orgInitials("Acme")).toBe("AC");
    expect(orgInitials("  ")).toBe("?");
  });
});
