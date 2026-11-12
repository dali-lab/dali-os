import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isNonMember: vi.fn(),
  isPartnerAccount: vi.fn(),
  getUserRoles: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

vi.mock("~/lib/auth", async () => {
  const { redirect } = await import("react-router");
  return {
    requireAuth: mocks.requireAuth,
    isNonMember: mocks.isNonMember,
    redirectPartnerToPortal: async (auth: unknown) =>
      (await mocks.isPartnerAccount(auth)) ? redirect("/partner") : null,
  };
});
vi.mock("~/lib/roles", () => ({ getUserRoles: mocks.getUserRoles }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: mocks.isFeatureEnabled }));
vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/groups.server", () => ({ listVisibleGroupIdsForUser: vi.fn().mockResolvedValue([]) }));

import { requireFeedbackViewer } from "../feedback.server";
import { requireResourcesViewer } from "../resources.server";
import { requireReleaseNoteViewer } from "../release-notes.server";
import { requireCommunityViewer } from "~/community/lib/community.server";
import { requireJourneyViewer } from "~/journeys/lib/journeys.server";

const user = { sub: "u1", email: "ada@example.edu", firstName: "Ada", lastName: "L" };
const req = new Request("http://localhost/x");
const roles = (over: Record<string, boolean> = {}) => ({
  isLabMember: true,
  isCore: false,
  isDomainLead: false,
  isAlumni: false,
  ...over,
});

const gates: [string, (r: Request) => Promise<unknown>][] = [
  ["feedback", requireFeedbackViewer],
  ["resources", requireResourcesViewer],
  ["release notes", requireReleaseNoteViewer],
  ["community", requireCommunityViewer],
  ["journeys", requireJourneyViewer],
];

async function thrown(p: Promise<unknown>): Promise<Response> {
  try {
    await p;
  } catch (e) {
    return e as Response;
  }
  throw new Error("did not throw");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAuth.mockResolvedValue({ ok: true, user });
  mocks.isNonMember.mockResolvedValue(false);
  mocks.isPartnerAccount.mockResolvedValue(false);
  mocks.getUserRoles.mockResolvedValue(roles());
  mocks.isFeatureEnabled.mockResolvedValue(true);
});

describe.each(gates)("%s gate", (_name, gate) => {
  it("allows a current member", async () => {
    await expect(gate(req)).resolves.toBeTruthy();
  });

  it("allows an alumnus with a member row", async () => {
    mocks.getUserRoles.mockResolvedValue(roles({ isAlumni: true }));
    await expect(gate(req)).resolves.toBeTruthy();
  });

  it("sends a non-member to /portal", async () => {
    mocks.isNonMember.mockResolvedValue(true);
    expect((await thrown(gate(req))).headers.get("Location")).toBe("/portal");
  });

  it("sends a partner to /partner", async () => {
    mocks.isNonMember.mockResolvedValue(true);
    mocks.isPartnerAccount.mockResolvedValue(true);
    expect((await thrown(gate(req))).headers.get("Location")).toBe("/partner");
  });

  it("sends a signed-out visitor to login", async () => {
    mocks.requireAuth.mockResolvedValue({ ok: false });
    expect((await thrown(gate(req))).headers.get("Location")).toContain("/login");
  });
});
