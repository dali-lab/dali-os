import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
  loadPaperwork: vi.fn(),
  loadPaperworkCount: vi.fn(),
}));

vi.mock("~/lib/auth", () => ({ requireAuth: m.requireAuth, isNonMember: m.isNonMember }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })) }));
vi.mock("~/lib/roles", () => ({ getUserRoles: m.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: m.isFeatureEnabled }));
vi.mock("../../lib/paperwork.server", () => ({ loadPaperwork: m.loadPaperwork, loadPaperworkCount: m.loadPaperworkCount }));
vi.mock("../../components/PaperworkPage", () => ({ PaperworkPage: () => null }));

import { loader as pageLoader } from "../paperwork";
import { loader as countLoader } from "../api.paperwork.count";

const req = () => new Request("https://os.example/paperwork");
const page = () => pageLoader({ request: req() } as never);
const count = () => countLoader({ request: req() } as never) as Promise<Response>;
const thrown = async (p: Promise<unknown>) => p.then(() => null, (e) => e as Response);
const MEMBER = { isAlumni: false, isStaff: false };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
  m.isNonMember.mockResolvedValue(false);
  m.getUserRoles.mockResolvedValue(MEMBER);
  m.isFeatureEnabled.mockResolvedValue(true);
  m.loadPaperwork.mockResolvedValue({ waiting: [] });
  m.loadPaperworkCount.mockResolvedValue(3);
});

describe("/paperwork", () => {
  it("loads the signed-in member's paperwork", async () => {
    expect(await page()).toEqual({ waiting: [] });
    expect(m.loadPaperwork).toHaveBeenCalledWith("u1", MEMBER, expect.any(Request));
    expect(m.isFeatureEnabled).toHaveBeenCalledWith("paperwork", "u1", MEMBER, expect.any(Request));
  });

  it("sends a signed-out visitor to log in", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await thrown(page()))?.status).toBe(302);
    expect(m.loadPaperwork).not.toHaveBeenCalled();
  });

  it("sends a non-member to the portal", async () => {
    m.isNonMember.mockResolvedValue(true);
    const res = await thrown(page());
    expect(res?.headers.get("Location")).toBe("/portal");
    expect(m.loadPaperwork).not.toHaveBeenCalled();
  });

  it("is not found for alumni", async () => {
    m.getUserRoles.mockResolvedValue({ ...MEMBER, isAlumni: true });
    expect((await thrown(page()))?.status).toBe(404);
    expect(m.loadPaperwork).not.toHaveBeenCalled();
  });

  it("is not found while the flag is off", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect((await thrown(page()))?.status).toBe(404);
    expect(m.loadPaperwork).not.toHaveBeenCalled();
  });
});

describe("/api/paperwork/count", () => {
  it("returns the member's count", async () => {
    const res = await count();
    expect(await res.json()).toEqual({ count: 3 });
    expect(m.loadPaperworkCount).toHaveBeenCalledWith("u1", MEMBER, expect.any(Request));
  });

  it("returns zero while the flag is off or for alumni, without loading anything", async () => {
    m.isFeatureEnabled.mockResolvedValue(false);
    expect(await (await count()).json()).toEqual({ count: 0 });
    m.isFeatureEnabled.mockResolvedValue(true);
    m.getUserRoles.mockResolvedValue({ ...MEMBER, isAlumni: true });
    expect(await (await count()).json()).toEqual({ count: 0 });
    expect(m.loadPaperworkCount).not.toHaveBeenCalled();
  });

  it("rejects signed-out visitors and non-members", async () => {
    m.requireAuth.mockResolvedValue({ ok: false });
    expect((await count()).status).toBe(401);
    m.requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m.isNonMember.mockResolvedValue(true);
    expect((await count()).status).toBe(403);
    expect(m.loadPaperworkCount).not.toHaveBeenCalled();
  });
});
