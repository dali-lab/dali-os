import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("../../lib/partner-directory", async (orig) => ({
  ...(await orig<typeof import("../../lib/partner-directory")>()),
  listPartnerOrgRows: vi.fn(),
  listPartnerContactRows: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listPartnerOrgRows, listPartnerContactRows } from "../../lib/partner-directory";
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
});
