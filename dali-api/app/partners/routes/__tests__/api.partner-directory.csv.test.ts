import { describe, it, expect, beforeEach, vi } from "vitest";
vi.mock("~/lib/db.server", () => ({ prisma: {} }));

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn().mockResolvedValue(false) }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("../../lib/partner-directory.server", () => ({
  listPartnerDirectoryRows: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listPartnerDirectoryRows } from "../../lib/partner-directory.server";
import type { PartnerDirectoryRow } from "../../lib/partner-directory";
import { loader } from "../api.partner-directory.csv";

function get(url: string) {
  return loader({ request: new Request(url), params: {}, context: {} } as never);
}

const row = (over: Partial<PartnerDirectoryRow>): PartnerDirectoryRow => ({
  kind: "org",
  id: over.name ?? "r",
  name: "Acme",
  email: null,
  title: null,
  website: null,
  logoUrl: null,
  type: null,
  status: "Active",
  orgNames: [],
  memberCount: 1,
  activeProjectCount: 1,
  totalProjectCount: 1,
  applicationCount: null,
  lastActivityAt: null,
  ...over,
});

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

  it("exports the whole directory as one CSV", async () => {
    vi.mocked(listPartnerDirectoryRows).mockResolvedValue([
      row({ name: "Acme" }),
      row({ kind: "person", name: "Jo", status: null, orgNames: ["Acme"] }),
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv")) as Response;
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("partner-directory-");
    const body = await res.text();
    expect(body).toContain("Acme");
    expect(body).toContain("Jo");
  });

  it("applies the query before exporting", async () => {
    vi.mocked(listPartnerDirectoryRows).mockResolvedValue([
      row({ name: "Acme" }),
      row({ name: "Beta" }),
    ]);
    const res = (await get("http://localhost/api/partner-directory.csv?q=acme")) as Response;
    const body = await res.text();
    expect(body).toContain("Acme");
    expect(body).not.toContain("Beta");
  });

  it("applies repeated column-filter params before exporting", async () => {
    vi.mocked(listPartnerDirectoryRows).mockResolvedValue([
      row({ name: "Acme", type: "Company" }),
      row({ name: "Beta", type: "Nonprofit" }),
      row({ kind: "person", name: "Jo", status: null, type: null }),
    ]);
    const res = (await get(
      "http://localhost/api/partner-directory.csv?kind=Organization&type=Company",
    )) as Response;
    const body = await res.text();
    expect(body).toContain("Acme");
    expect(body).not.toContain("Beta");
    expect(body).not.toContain("Jo");
  });
});
