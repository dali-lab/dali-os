import { describe, it, expect } from "vitest";
import { partnerContactsCsvRows, partnerOrgsCsvRows } from "../partner-directory";
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
