import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ canViewStaffing: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewStaffing } from "~/lib/roles";
import * as intent from "../core.intent-to-work.$userId";
import * as bids from "../core.project-bids.$userId";
import * as levelUp from "../core.level-up.$userId";

const ROUTES = [
  { slot: "intent-to-work", route: intent },
  { slot: "project-bids", route: bids },
  { slot: "level-up", route: levelUp },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canViewStaffing).mockResolvedValue(true);
});

describe.each(ROUTES)("$slot detail page", ({ slot, route }) => {
  const load = () =>
    route.loader({
      request: new Request(`http://os.test/core/${slot}/ada?term=t-26s`),
      params: { userId: "ada" },
    } as never) as Promise<Response>;

  it("opens the member in the board's drawer, keeping the term", async () => {
    const res = await load();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/core/${slot}?term=t-26s&open=ada`);
  });

  it("sends a signed-out visitor to login", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    vi.mocked(redirectToLogin).mockReturnValue(new Response(null, { status: 302, headers: { Location: "/login" } }) as never);
    const res = await load();
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("checks staffing access before redirecting", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    const res = await load();
    expect(res.headers.get("Location")).toBe("/");
  });
});
