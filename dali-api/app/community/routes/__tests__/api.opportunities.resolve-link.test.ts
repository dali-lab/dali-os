import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireCommunityViewer: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveJobLink: vi.fn(),
  storeLogo: vi.fn(),
  inlineLogoDataUrl: vi.fn(),
}));

vi.mock("~/community/lib/community.server", () => ({ requireCommunityViewer: mocks.requireCommunityViewer }));
vi.mock("~/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("~/community/lib/job-link.server", async () => ({
  resolveJobLink: mocks.resolveJobLink,
  storeLogo: mocks.storeLogo,
  inlineLogoDataUrl: mocks.inlineLogoDataUrl,
  logoUrlForKey: (k: string | null) => (k ? `/api/upload/raw?key=${encodeURIComponent(k)}` : null),
}));

import { action } from "~/community/routes/api.opportunities.resolve-link";

const req = (url: string) => {
  const body = new FormData();
  body.set("url", url);
  return new Request("https://os.test/api/opportunities/resolve-link", { method: "POST", body });
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireCommunityViewer.mockResolvedValue({ user: { sub: "u1" }, core: false });
  mocks.checkRateLimit.mockReturnValue(null);
});

describe("POST resolve-link", () => {
  it("propagates the auth rejection", async () => {
    const denied = new Response("Not found", { status: 404 });
    mocks.requireCommunityViewer.mockRejectedValue(denied);
    await expect(action({ request: req("https://x.com") })).rejects.toBe(denied);
    expect(mocks.resolveJobLink).not.toHaveBeenCalled();
  });

  it("returns the rate limit response", async () => {
    const limited = new Response("{}", { status: 429 });
    mocks.checkRateLimit.mockReturnValue(limited);
    expect(await action({ request: req("https://x.com") })).toBe(limited);
    expect(mocks.checkRateLimit.mock.calls[0][2]).toBe("opp-resolve:u1");
  });

  it("returns 400 for an unusable url", async () => {
    mocks.resolveJobLink.mockResolvedValue(null);
    const res = await action({ request: req("http://x.com") });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("returns 400 for an empty url without resolving", async () => {
    const res = await action({ request: req("  ") });
    expect(res.status).toBe(400);
    expect(mocks.resolveJobLink).not.toHaveBeenCalled();
  });

  it("returns the link with a logo key and servable url", async () => {
    mocks.resolveJobLink.mockResolvedValue({
      url: "https://jobs.ashbyhq.com/acme/1",
      companyName: "Acme",
      companyDomain: "acme.com",
      role: "Engineer",
      location: "Boston, MA",
      jobType: "Full time",
      logoSourceUrl: "https://cdn.acme.com/logo.png",
    });
    const stored = { key: "uploads/opportunities/logos/a.png", bytes: new Uint8Array([1]), contentType: "image/png" };
    mocks.storeLogo.mockResolvedValue(stored);
    mocks.inlineLogoDataUrl.mockReturnValue("data:image/png;base64,AQ==");
    const res = await action({ request: req("https://jobs.ashbyhq.com/acme/1") });
    expect(await res.json()).toEqual({
      ok: true,
      link: {
        url: "https://jobs.ashbyhq.com/acme/1",
        companyName: "Acme",
        companyDomain: "acme.com",
        role: "Engineer",
        location: "Boston, MA",
        jobType: "Full time",
        logoKey: "uploads/opportunities/logos/a.png",
        logoUrl: "/api/upload/raw?key=uploads%2Fopportunities%2Flogos%2Fa.png",
        logoDataUrl: "data:image/png;base64,AQ==",
      },
    });
    expect(mocks.inlineLogoDataUrl).toHaveBeenCalledWith(stored);
  });

  it("returns null logo fields when there is no logo", async () => {
    mocks.resolveJobLink.mockResolvedValue({
      url: "https://linkedin.com/jobs/1",
      companyName: null,
      companyDomain: null,
      role: null,
      location: null,
      jobType: null,
      logoSourceUrl: null,
    });
    const body = await (await action({ request: req("https://linkedin.com/jobs/1") })).json();
    expect(body.link.logoKey).toBeNull();
    expect(body.link.logoUrl).toBeNull();
    expect(body.link.logoDataUrl).toBeNull();
    expect(mocks.storeLogo).not.toHaveBeenCalled();
  });
});
