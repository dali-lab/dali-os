import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })) }));
vi.mock("~/lib/drive-reveal.server", () => ({ driveRevealHref: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { driveRevealHref } from "~/lib/drive-reveal.server";
import { loader } from "~/routes/drive.reveal.$pageId";

const request = new Request("http://localhost/drive/reveal/p1");
const run = () => loader({ request, params: { pageId: "p1" } } as never);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
});

describe("GET /drive/reveal/:pageId", () => {
  it("redirects to the page's folder with the page selected", async () => {
    vi.mocked(driveRevealHref).mockResolvedValue("/drive?scope=lab&folder=f1&select=p1");
    const res = (await run()) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/drive?scope=lab&folder=f1&select=p1");
    expect(driveRevealHref).toHaveBeenCalledWith("p1", "u1", request);
  });

  it("is a 404 for a page the viewer cannot open", async () => {
    vi.mocked(driveRevealHref).mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ status: 404 });
  });

  it("sends a signed-out viewer to log in", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    const res = (await run()) as Response;
    expect(res.headers.get("Location")).toBe("/login");
    expect(driveRevealHref).not.toHaveBeenCalled();
  });
});
