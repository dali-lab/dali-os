import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockContactFind = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db.server", () => ({ prisma: { partnerContact: { findUnique: mockContactFind } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: mockRequireAuth }));

import { loader } from "~/partners/routes/partner.login";

async function landing(url = "http://localhost/partner/login") {
  const res = (await loader({ request: new Request(url) } as any)) as Response;
  expect(res.status).toBe(302);
  return res.headers.get("Location");
}

function signedInAs(type: string) {
  mockRequireAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type }, sessionId: "s" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue({ ok: false });
  mockContactFind.mockResolvedValue(null);
});

describe("GET /partner/login", () => {
  it("sends a signed-out visitor to /login", async () => {
    expect(await landing()).toBe("/login");
  });

  it("forwards a safe next to /login and drops an unsafe one", async () => {
    expect(await landing("http://localhost/partner/login?next=%2Fpartner%2Fapply")).toBe(
      "/login?next=%2Fpartner%2Fapply",
    );
    expect(await landing("http://localhost/partner/login?next=%2F%2Fevil.com")).toBe("/login");
  });

  it("sends a member home and a Dartmouth account to the portal", async () => {
    signedInAs("member");
    expect(await landing()).toBe("/");
    signedInAs("dartmouth");
    expect(await landing()).toBe("/portal");
  });

  it("sends a partner with a contact to /partner, and one without to onboarding", async () => {
    signedInAs("partner");
    mockContactFind.mockResolvedValue({ id: "pc1" });
    expect(await landing()).toBe("/partner");
    mockContactFind.mockResolvedValue(null);
    expect(await landing()).toBe("/partner/onboarding");
  });
});
