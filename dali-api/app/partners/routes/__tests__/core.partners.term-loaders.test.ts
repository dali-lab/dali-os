import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({
  term: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  partnerCrmSettings: { findUnique: vi.fn().mockResolvedValue(null) },
}));
vi.mock("~/lib/db.server", () => ({ prisma }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/core-members.server", () => ({ listActiveCoreMembers: vi.fn() }));
vi.mock("../../lib/partner-renewals.server", () => ({
  applyContinue: vi.fn(),
  applyMaintain: vi.fn(),
  applyNotContinuing: vi.fn(),
  applyUndecided: vi.fn(),
  loadRenewalCards: vi.fn(),
  setTermPi: vi.fn(),
}));
vi.mock("../../lib/partner-reports.server", () => ({
  resolveReportsTerm: vi.fn(),
  loadFunnelSection: vi.fn(),
  loadCycleTimeSection: vi.fn(),
  loadRejectionReasonsSection: vi.fn(),
  loadPartnerMixSection: vi.fn(),
  loadRevenueSection: vi.fn(),
}));

import { requireAuth, isNonMember } from "~/lib/auth";
import { currentTerm, isCore } from "~/lib/roles";
import { listActiveCoreMembers } from "~/lib/core-members.server";
import { loadRenewalCards } from "../../lib/partner-renewals.server";
import * as reportsLib from "../../lib/partner-reports.server";
import { loader as renewalsLoader } from "../core.partners.renewals";
import { loader as reportsLoader } from "../core.partners.reports";

const TERMS = [
  { id: "t-26s", code: "26S", sortKey: 1 },
  { id: "t-26x", code: "26X", sortKey: 2 },
  { id: "t-26f", code: "26F", sortKey: 3 },
];

const call = <T>(loader: (args: never) => Promise<T>, search: string) =>
  loader({ request: new Request(`https://dali.test/core/partners/x${search}`), params: {}, context: {} } as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t-26x", code: "26X" } as never);
  prisma.term.findMany.mockResolvedValue(TERMS);
  prisma.domain.findMany.mockResolvedValue([]);
  vi.mocked(listActiveCoreMembers).mockResolvedValue([]);
  vi.mocked(loadRenewalCards).mockResolvedValue({ decisionTerm: TERMS[2], cards: [] } as never);
});

describe("renewals loader term", () => {
  const picked = async (search: string) => (await call(renewalsLoader, search) as { picked: { id: string } | null }).picked?.id;

  it("defaults to the current term", async () => {
    expect(await picked("")).toBe("t-26x");
  });

  it("reads ?term=<id>", async () => {
    expect(await picked("?term=t-26s")).toBe("t-26s");
  });

  it("still reads an old ?term=<code> link", async () => {
    expect(await picked("?term=26F")).toBe("t-26f");
  });

  it("falls back to the current term for an unknown value", async () => {
    expect(await picked("?term=nope")).toBe("t-26x");
  });

  it("returns picker options newest first with the current term marked", async () => {
    const data = (await call(renewalsLoader, "")) as { termOptions: unknown };
    expect(data.termOptions).toEqual([
      { id: "t-26f", code: "26F", isCurrent: false },
      { id: "t-26x", code: "26X", isCurrent: true },
      { id: "t-26s", code: "26S", isCurrent: false },
    ]);
  });
});

describe("reports loader term", () => {
  beforeEach(() => {
    vi.mocked(reportsLib.resolveReportsTerm).mockResolvedValue({
      terms: [...TERMS].reverse().map(({ id, code }) => ({ id, code })),
      selectedTermId: "t-26s",
      selectedTermCode: "26S",
    } as never);
    vi.mocked(reportsLib.loadFunnelSection).mockResolvedValue({
      funnel: {},
      reached: {},
      bySource: [],
      applications: [],
    } as never);
    for (const fn of ["loadCycleTimeSection", "loadRejectionReasonsSection", "loadPartnerMixSection", "loadRevenueSection"] as const) {
      vi.mocked(reportsLib[fn]).mockResolvedValue([] as never);
    }
  });

  it("passes ?term= to the term resolver", async () => {
    await call(reportsLoader, "?term=all");
    expect(reportsLib.resolveReportsTerm).toHaveBeenCalledWith("all");
  });

  it("marks the current term for the picker", async () => {
    const data = (await call(reportsLoader, "")) as { terms: unknown; selectedTermId: string };
    expect(data.selectedTermId).toBe("t-26s");
    expect(data.terms).toEqual([
      { id: "t-26f", code: "26F", isCurrent: false },
      { id: "t-26x", code: "26X", isCurrent: true },
      { id: "t-26s", code: "26S", isCurrent: false },
    ]);
  });
});
