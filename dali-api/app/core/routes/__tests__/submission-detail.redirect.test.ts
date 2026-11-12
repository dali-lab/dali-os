import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { term: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ canViewStaffing: vi.fn(), currentTerm: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("~/projects/lib/staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("~/projects/lib/form-slots", () => ({ getSlotBinding: vi.fn() }));
vi.mock("~/projects/lib/submission-view.server", () => ({ buildSubmissionView: vi.fn() }));
vi.mock("~/core/coreNav", () => ({ coreHandle: () => ({}) }));
vi.mock("~/projects/components/UserSubmissionShell", () => ({ UserSubmissionShell: () => null }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canViewStaffing } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { resolveTermFilter } from "~/lib/terms";
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
  vi.mocked(resolveTermFilter).mockResolvedValue({ termId: null, isAll: false } as never);
});

describe.each(ROUTES)("$slot detail page", ({ slot, route }) => {
  const load = () =>
    route.loader({
      request: new Request(`http://os.test/core/${slot}/ada?term=t-26s`),
      params: { userId: "ada" },
    } as never) as Promise<Response>;

  it("opens the member in the board's drawer when the flag is on, keeping the term", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await load();
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(`/core/${slot}?term=t-26s&open=ada`);
  });

  it("keeps the page when the flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const res = await load();
    expect(res.headers.get("Location")).not.toContain("open=");
  });

  it("checks staffing access before anything else", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    const res = await load();
    expect(res.headers.get("Location")).toBe("/");
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });
});
