import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabled: vi.fn(),
}));
vi.mock("~/lib/roles", () => ({
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/groups", () => ({
  resolveGroupMembers: vi.fn().mockResolvedValue([]),
}));
vi.mock("~/signing/lib/state.server", () => ({
  getSignerCohorts: vi.fn(),
}));
vi.mock("~/forms/lib/public-form", () => ({
  existingBoundSubmission: vi.fn(),
  formFillAccess: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { getBoundFormGateOutstanding } from "~/forms/lib/gate.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { currentTerm } from "~/lib/roles";
import { getSignerCohorts } from "~/signing/lib/state.server";
import {
  existingBoundSubmission,
  formFillAccess,
} from "~/forms/lib/public-form";
import type { UserRoles } from "~/lib/roles";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockFlag = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;
const mockTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;
const mockCohorts = getSignerCohorts as unknown as ReturnType<typeof vi.fn>;
const mockExisting = existingBoundSubmission as unknown as ReturnType<
  typeof vi.fn
>;
const mockAccess = formFillAccess as unknown as ReturnType<typeof vi.fn>;

const ROLES = {} as UserRoles;

// Cohorts that land in the "Members" audience (staffed this term, not new).
const RETURNING_MEMBER = {
  isMember: true,
  isStaffedThisTerm: true,
  isNewStaffed: false,
  isMentor: false,
  isActiveThisTerm: true,
};

// A locked Intent to Work binding for the "Members" audience.
function membersBinding(overrides: Record<string, unknown> = {}) {
  return {
    slot: "intent-to-work",
    gateAudience: "Members",
    gateAudienceGroupId: null,
    form: {
      name: "Intent to Work",
      publicToken: "tok-1",
      audience: "Members",
      audienceGroupIds: [],
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockFlag.mockResolvedValue(true);
  mockTerm.mockResolvedValue({ id: "term-1", sortKey: 1 });
  mockPrisma.staffingCycle.findUnique.mockResolvedValue({ id: "cyc-1" });
  mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([
    membersBinding(),
  ]);
  mockCohorts.mockResolvedValue(RETURNING_MEMBER);
  mockAccess.mockResolvedValue("ok");
  mockExisting.mockResolvedValue(null);
});

describe("getBoundFormGateOutstanding", () => {
  it("returns the owed form for an in-audience member who hasn't filled it", async () => {
    const owed = await getBoundFormGateOutstanding("user-1", ROLES);
    expect(owed).toEqual({
      token: "tok-1",
      slot: "intent-to-work",
      formName: "Intent to Work",
    });
    expect(mockExisting).toHaveBeenCalledWith("user-1", "cyc-1", "intent-to-work");
  });

  it("short-circuits to null when the flag is off (no queries)", async () => {
    mockFlag.mockResolvedValue(false);
    const owed = await getBoundFormGateOutstanding("user-1", ROLES);
    expect(owed).toBeNull();
    expect(mockTerm).not.toHaveBeenCalled();
    expect(mockPrisma.staffingCycleFormBinding.findMany).not.toHaveBeenCalled();
  });

  it("returns null when the member already filled it", async () => {
    mockExisting.mockResolvedValue({ id: "sub-0", createdAt: new Date() });
    expect(await getBoundFormGateOutstanding("user-1", ROLES)).toBeNull();
  });

  it("returns null when the member is outside the gate audience", async () => {
    // Not staffed this term ⇒ not in the Members audience.
    mockCohorts.mockResolvedValue({
      ...RETURNING_MEMBER,
      isStaffedThisTerm: false,
      isActiveThisTerm: false,
    });
    expect(await getBoundFormGateOutstanding("user-1", ROLES)).toBeNull();
    // In-audience check fails before we ever look for a submission.
    expect(mockExisting).not.toHaveBeenCalled();
  });

  it("does not gate a member who can't actually fill the form", async () => {
    // In the gate audience, but the form's own fill audience excludes them —
    // redirecting would dead-end on the access screen.
    mockAccess.mockResolvedValue("denied");
    expect(await getBoundFormGateOutstanding("user-1", ROLES)).toBeNull();
    expect(mockExisting).not.toHaveBeenCalled();
  });

  it("returns null when no cycle exists for the current term", async () => {
    mockPrisma.staffingCycle.findUnique.mockResolvedValue(null);
    expect(await getBoundFormGateOutstanding("user-1", ROLES)).toBeNull();
    expect(mockPrisma.staffingCycleFormBinding.findMany).not.toHaveBeenCalled();
  });

  it("returns null when nothing is gated", async () => {
    mockPrisma.staffingCycleFormBinding.findMany.mockResolvedValue([]);
    expect(await getBoundFormGateOutstanding("user-1", ROLES)).toBeNull();
    // No cohort resolution when there are no gated bindings.
    expect(mockCohorts).not.toHaveBeenCalled();
  });
});
