import { describe, it, expect } from "vitest";
import {
  DEFAULT_DIRECTORY_SORT,
  DEFAULT_ORG_FILTERS,
  activeOrgFilterCount,
  directoryExportHref,
  filterContactRows,
  filterOrgRows,
  isDirectorySort,
  nextDirectorySort,
  orgFiltersFromParams,
  orgInitials,
  partnerContactsCsvRows,
  partnerOrgsCsvRows,
  sortDirectoryRows,
} from "../partner-directory";
import type {
  PartnerContactDirectoryRow,
  PartnerOrgDirectoryRow,
} from "../partner-directory";

describe("partnerOrgsCsvRows", () => {
  it("builds a header row plus one row per org", () => {
    const orgs: PartnerOrgDirectoryRow[] = [
      {
        id: "org-1",
        name: "Acme Corp",
        logoUrl: null,
        website: "https://acme.com",
        isIndividual: false,
        type: "Company",
        status: "Active",
        memberCount: 3,
        activeProjectCount: 1,
        totalProjectCount: 2,
        lastActivityAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const rows = partnerOrgsCsvRows(orgs);
    expect(rows[0]).toEqual([
      "Name",
      "Type",
      "Website",
      "Individual",
      "Status",
      "Members",
      "Active projects",
      "Total projects",
      "Last activity",
    ]);
    expect(rows[1]).toEqual([
      "Acme Corp",
      "Company",
      "https://acme.com",
      "No",
      "Active",
      3,
      1,
      2,
      "2026-01-01T00:00:00.000Z",
    ]);
  });

  it("falls back to blanks for unset fields", () => {
    const orgs: PartnerOrgDirectoryRow[] = [
      {
        id: "org-2",
        name: "Solo Partner",
        logoUrl: null,
        website: null,
        isIndividual: true,
        type: null,
        status: "Prospect",
        memberCount: 1,
        activeProjectCount: 0,
        totalProjectCount: 0,
        lastActivityAt: null,
      },
    ];
    const rows = partnerOrgsCsvRows(orgs);
    expect(rows[1]).toEqual(["Solo Partner", "", "", "Yes", "Prospect", 1, 0, 0, ""]);
  });
});

describe("partnerContactsCsvRows", () => {
  it("joins multiple orgs with a semicolon", () => {
    const contacts: PartnerContactDirectoryRow[] = [
      {
        id: "c1",
        name: "Jo",
        email: "jo@acme.com",
        title: "CTO",
        affiliation: null,
        orgs: [{ id: "org-1", name: "Acme" }, { id: "org-2", name: "Beta" }],
        applicationCount: 2,
        lastActivityAt: "2026-02-01T00:00:00.000Z",
      },
    ];
    const rows = partnerContactsCsvRows(contacts);
    expect(rows[0]).toEqual([
      "Name",
      "Email",
      "Title",
      "Affiliation",
      "Organizations",
      "Applications",
      "Last activity",
    ]);
    expect(rows[1]).toEqual([
      "Jo",
      "jo@acme.com",
      "CTO",
      "",
      "Acme; Beta",
      2,
      "2026-02-01T00:00:00.000Z",
    ]);
  });
});

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

describe("filterOrgRows", () => {
  const rows = [
    org({ name: "Acme", type: "Company", status: "Active" }),
    org({ name: "Jo Smith", type: null, status: "Prospect", isIndividual: true }),
    org({ name: "Beta Lab", type: "Nonprofit", status: "Dormant" }),
  ];

  it("filters by name, type, status and individuals", () => {
    expect(filterOrgRows(rows, { ...DEFAULT_ORG_FILTERS, query: "lab" }).map((r) => r.name)).toEqual([
      "Beta Lab",
    ]);
    expect(filterOrgRows(rows, { ...DEFAULT_ORG_FILTERS, type: "Company" })).toHaveLength(1);
    expect(filterOrgRows(rows, { ...DEFAULT_ORG_FILTERS, status: "Prospect" })).toHaveLength(1);
    expect(
      filterOrgRows(rows, { ...DEFAULT_ORG_FILTERS, includeIndividuals: false }).map((r) => r.name),
    ).toEqual(["Acme", "Beta Lab"]);
  });

  it("returns everything with default filters", () => {
    expect(filterOrgRows(rows, DEFAULT_ORG_FILTERS)).toHaveLength(3);
  });
});

describe("filterContactRows", () => {
  const contacts: PartnerContactDirectoryRow[] = [
    {
      id: "c1",
      name: "Jo",
      email: "jo@acme.com",
      title: null,
      affiliation: null,
      orgs: [{ id: "o1", name: "Acme" }],
      applicationCount: 0,
      lastActivityAt: null,
    },
    {
      id: "c2",
      name: "Sam",
      email: null,
      title: null,
      affiliation: null,
      orgs: [],
      applicationCount: 0,
      lastActivityAt: null,
    },
  ];

  it("matches name, email and organization names", () => {
    expect(filterContactRows(contacts, "acme")).toHaveLength(1);
    expect(filterContactRows(contacts, "sam")).toHaveLength(1);
    expect(filterContactRows(contacts, "  ")).toHaveLength(2);
  });
});

describe("activeOrgFilterCount", () => {
  it("counts only non-default filters", () => {
    expect(activeOrgFilterCount(DEFAULT_ORG_FILTERS)).toBe(0);
    expect(
      activeOrgFilterCount({ query: "x", type: "Company", status: "Active", includeIndividuals: false }),
    ).toBe(3);
  });
});

describe("directoryExportHref and orgFiltersFromParams", () => {
  it("round-trips the filtered view", () => {
    const href = directoryExportHref("orgs", " acme ", {
      type: "Company",
      status: "all",
      includeIndividuals: false,
    });
    expect(href).toBe("/api/partner-directory.csv?view=orgs&q=acme&type=Company&individuals=0");
    const params = new URL(href, "http://x").searchParams;
    expect(orgFiltersFromParams(params)).toEqual({
      query: "acme",
      type: "Company",
      status: "all",
      includeIndividuals: false,
    });
  });

  it("ignores org filters for the contacts view", () => {
    expect(
      directoryExportHref("contacts", "jo", { type: "Company", status: "Active", includeIndividuals: false }),
    ).toBe("/api/partner-directory.csv?view=contacts&q=jo");
  });
});

describe("orgInitials", () => {
  it("uses two letters", () => {
    expect(orgInitials("Acme Corp")).toBe("AC");
    expect(orgInitials("Acme")).toBe("AC");
    expect(orgInitials("  ")).toBe("?");
  });
});
