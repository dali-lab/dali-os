import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  redirectNonMemberToPortal: vi.fn(),
}));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
}));
vi.mock("~/projects/lib/showcase-view.server", () => ({ getShowcaseView: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { getShowcaseView } from "~/projects/lib/showcase-view.server";
import { loader } from "~/projects/routes/projects.$id.showcase";

const run = () =>
  loader({
    request: new Request("http://localhost/projects/p1/showcase"),
    params: { id: "p1" },
    context: {},
  } as never) as Promise<any>;

const VIEW = {
  id: "p1",
  name: "Beacon",
  tagline: "",
  year: 2026,
  partners: [],
  coverUrl: null,
  products: [],
  sectors: [],
  techStack: [],
  links: [],
  teamMembers: [],
  details: [],
  media: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(getShowcaseView).mockResolvedValue(VIEW as never);
  vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: false } as never);
});

describe("project showcase loader", () => {
  it("returns the published showcase view", async () => {
    const data = await run();
    expect(getShowcaseView).toHaveBeenCalledWith("p1");
    expect(data.showcase).toEqual(VIEW);
  });

  it("offers the view switch to members but not alumni", async () => {
    expect((await run()).canSwitchViews).toBe(true);
    vi.mocked(getUserRoles).mockResolvedValue({ isAlumni: true } as never);
    expect((await run()).canSwitchViews).toBe(false);
  });

  it("404s when the project has no published showcase", async () => {
    vi.mocked(getShowcaseView).mockResolvedValue(null as never);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });

  it("sends a signed-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = await run();
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(getShowcaseView).not.toHaveBeenCalled();
  });

  it("sends a non-member to the portal", async () => {
    const portal = new Response(null, { status: 302, headers: { Location: "/portal" } });
    vi.mocked(redirectNonMemberToPortal).mockResolvedValue(portal as never);
    const res = await run();
    expect(res).toBe(portal);
    expect(getShowcaseView).not.toHaveBeenCalled();
  });
});
