import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("~/lib/db.server", () => ({ prisma: {} }));

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("../../lib/partner-directory.server", () => ({
  listPartnerOrgRows: vi.fn(),
  listPartnerContactRows: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listPartnerOrgRows, listPartnerContactRows } from "../../lib/partner-directory.server";
import { loader } from "../api.partner-directory.csv";

function get(url: string) {
  return loader({ request: new Request(url), params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "u1", type: "member" },
  } as never);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("GET /api/partner-directory.csv", () => {
  it("rejects non-Core callers", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await get("http://localhost/api/partner-directory.csv")) as Response;
    expect(res.status).toBe(302);
  });

  it("defaults to the orgs view", async () => {
    vi.mocked(listPartnerOrgRows).mockResolvedValue([
      {
        id: "org-1",
        name: "Acme",
        logoUrl: null,
        website: null,
        isIndividual: false,
        type: null,
        status: "Active",
        memberCount: 1,
        activeProjectCount: 1,
        totalProjectCount: 1,
        lastActivityAt: null,
      },
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv")) as Response;
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("partner-orgs-");
    const body = await res.text();
    expect(body).toContain("Acme");
    expect(listPartnerContactRows).not.toHaveBeenCalled();
  });

  it("switches to the contacts view", async () => {
    vi.mocked(listPartnerContactRows).mockResolvedValue([
      {
        id: "c1",
        name: "Jo",
        email: "jo@acme.com",
        title: null,
        affiliation: null,
        orgs: [],
        applicationCount: 0,
        lastActivityAt: null,
      },
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv?view=contacts")) as Response;
    expect(res.headers.get("Content-Disposition")).toContain("partner-contacts-");
    const body = await res.text();
    expect(body).toContain("Jo");
    expect(listPartnerOrgRows).not.toHaveBeenCalled();
  });

  it("exports only the filtered orgs", async () => {
    const base = {
      logoUrl: null,
      website: null,
      isIndividual: false,
      type: null,
      status: "Active" as const,
      memberCount: 1,
      activeProjectCount: 1,
      totalProjectCount: 1,
      lastActivityAt: null,
    };
    vi.mocked(listPartnerOrgRows).mockResolvedValue([
      { ...base, id: "1", name: "Acme" },
      { ...base, id: "2", name: "Beta" },
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv?q=acme")) as Response;
    const body = await res.text();
    expect(body).toContain("Acme");
    expect(body).not.toContain("Beta");
  });

  it("exports only the filtered contacts", async () => {
    const base = {
      email: null,
      title: null,
      affiliation: null,
      orgs: [],
      applicationCount: 0,
      lastActivityAt: null,
    };
    vi.mocked(listPartnerContactRows).mockResolvedValue([
      { ...base, id: "1", name: "Jo" },
      { ...base, id: "2", name: "Sam" },
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv?view=contacts&q=sam")) as Response;
    const body = await res.text();
    expect(body).toContain("Sam");
    expect(body).not.toContain("Jo");
  });
});
