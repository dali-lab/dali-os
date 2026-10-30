import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ requireMember: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/hiring/lib/cycles", () => ({ getActiveCycleById: vi.fn(), getActiveCycles: vi.fn() }));
vi.mock("~/hiring/lib/domain-application", () => ({ reconcileDomainApplications: vi.fn() }));
vi.mock("~/hiring/lib/intern-eligibility", () => ({ currentInternDomains: vi.fn().mockResolvedValue([]) }));
vi.mock("~/hiring/lib/core-hiring.server", () => ({ getCoreDomain: vi.fn() }));
vi.mock("~/hiring/lib/application-form.server", () => ({ loadHiringForm: vi.fn() }));
vi.mock("~/hiring/lib/application-tracker.server", () => ({ loadApplicationTracker: vi.fn() }));
vi.mock("~/hiring/lib/applicant-groups.server", () => ({
  APPLICANT_GROUP_CONFIG: { Interns: { eligible: vi.fn().mockResolvedValue(true) } },
  applicantGroup: (_applicants: string, cycleId: string) => ({
    domainStrategy: "target-domains",
    eligible: vi.fn().mockResolvedValue(true),
    portalPath: `/fellowship/${cycleId}`,
    applicationType: "Intern",
  }),
  applicantPortalPath: (_applicants: string, cycleId: string) => `/fellowship/${cycleId}`,
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { requireMember } from "~/lib/roles";
import { getActiveCycleById, getActiveCycles } from "~/hiring/lib/cycles";
import { reconcileDomainApplications } from "~/hiring/lib/domain-application";
import { loadHiringForm } from "~/hiring/lib/application-form.server";
import {
  handleInternalCyclePortalAction,
  loadInternalCyclePortal,
} from "~/hiring/lib/internal-cycle-portal.server";

const mockPrisma = prisma as unknown as Record<string, any>;

const CYCLE_ID = "c1";
const CYCLE_CLOSE = new Date("2026-10-21T03:59:59.000Z");
const ENGS_CLOSE = new Date("2026-10-26T03:59:59.000Z");
const WINDOWS = [
  { domainId: "web", closeDate: null },
  { domainId: "engs", closeDate: ENGS_CLOSE },
];
const ACTIVE = {
  id: CYCLE_ID,
  name: "Fall Fellowship",
  applicants: "Interns",
  currentStatus: "Open",
  closeDate: CYCLE_CLOSE,
  domains: WINDOWS,
};

function post(intent: string, selectedDomainIds: string[], answers: Record<string, string> = { why: "x" }) {
  return new Request(`http://localhost/fellowship/${CYCLE_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      intent,
      answers: JSON.stringify(answers),
      selectedDomainIds: JSON.stringify(selectedDomainIds),
    }).toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-10-21T14:00:00.000Z"), toFake: ["Date"] });
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as any);
  vi.mocked(requireMember).mockResolvedValue({ id: "m1" } as any);
  vi.mocked(getActiveCycleById).mockResolvedValue(ACTIVE as any);
  vi.mocked(getActiveCycles).mockResolvedValue([ACTIVE] as any);
  vi.mocked(loadHiringForm).mockResolvedValue({
    versionId: "fv1",
    questions: [{ key: "why", type: "text", required: true, data: { label: "Why" } }],
  } as any);
  mockPrisma.user = { findUnique: vi.fn().mockResolvedValue({ timeZone: "America/New_York" }) };
  mockPrisma.applicationCycle = {
    findUniqueOrThrow: vi.fn().mockResolvedValue({ id: CYCLE_ID, closeDate: CYCLE_CLOSE, applicationFormId: "f1", domains: WINDOWS }),
    findUnique: vi.fn().mockResolvedValue({
      id: CYCLE_ID,
      name: "Fall Fellowship",
      closeDate: CYCLE_CLOSE,
      applicationFormId: "f1",
      hasInterviews: false,
      domains: [
        { domainId: "web", closeDate: null, domain: { code: "WEB", displayName: "Web" } },
        { domainId: "engs", closeDate: ENGS_CLOSE, domain: { code: "ENGS", displayName: "Engineering" } },
      ],
    }),
  };
  mockPrisma.application = {
    upsert: vi.fn().mockResolvedValue({ id: "app-1" }),
    findFirst: vi.fn().mockResolvedValue(null),
  };
  mockPrisma.applicationStatusUpdate = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("handleInternalCyclePortalAction: per-domain windows", () => {
  it("reads only ready domains' windows for the cycle", async () => {
    await handleInternalCyclePortalAction(post("save-draft", ["engs"]), "Interns", CYCLE_ID);
    expect(mockPrisma.applicationCycle.findUniqueOrThrow.mock.calls[0][0].include.domains).toEqual({
      where: { isReady: true },
      select: { domainId: true, closeDate: true },
    });
  });

  it("drops a closed domain from a saved draft and keeps the open one", async () => {
    const res = await handleInternalCyclePortalAction(post("save-draft", ["web", "engs"]), "Interns", CYCLE_ID);
    expect(res).toEqual({ saved: true });
    expect(reconcileDomainApplications).toHaveBeenCalledWith({ applicationId: "app-1", domainIds: ["engs"] });
  });

  it("submits with only the open domain when a closed one was also picked", async () => {
    const res = await handleInternalCyclePortalAction(post("submit", ["web", "engs"]), "Interns", CYCLE_ID);
    expect(res).toEqual({ submitted: true });
    expect(reconcileDomainApplications).toHaveBeenCalledWith({ applicationId: "app-1", domainIds: ["engs"] });
    expect(mockPrisma.applicationStatusUpdate.create).toHaveBeenCalledOnce();
  });

  it("refuses a submit whose every picked domain has closed, writing nothing", async () => {
    const res = (await handleInternalCyclePortalAction(post("submit", ["web"]), "Interns", CYCLE_ID)) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Every domain you picked has closed. Pick an open domain to submit." });
    expect(mockPrisma.application.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.applicationStatusUpdate.create).not.toHaveBeenCalled();
  });

  it("keeps the pick-a-domain message when nothing was picked", async () => {
    const res = (await handleInternalCyclePortalAction(post("submit", []), "Interns", CYCLE_ID)) as Response;
    expect(await res.json()).toEqual({ error: "Select at least one target domain before submitting." });
  });

  it("ignores a domain that isn't one of the cycle's ready domains", async () => {
    await handleInternalCyclePortalAction(post("save-draft", ["staged", "engs"]), "Interns", CYCLE_ID);
    expect(reconcileDomainApplications).toHaveBeenCalledWith({ applicationId: "app-1", domainIds: ["engs"] });
  });
});

describe("loadInternalCyclePortal: per-domain windows", () => {
  const req = () => new Request(`http://localhost/fellowship/${CYCLE_ID}`);

  it("marks each target domain closed or open with its own close, from ready domains only", async () => {
    const data = (await loadInternalCyclePortal(req(), "Interns", CYCLE_ID)) as any;
    expect(mockPrisma.applicationCycle.findUnique.mock.calls[0][0].include.domains.where).toEqual({ isReady: true });
    expect(data.cycle.targetDomains).toEqual([
      { id: "web", code: "WEB", displayName: "Web", closed: true, closeDate: CYCLE_CLOSE.toISOString() },
      { id: "engs", code: "ENGS", displayName: "Engineering", closed: false, closeDate: ENGS_CLOSE.toISOString() },
    ]);
  });

  it("shows the latest open close as the deadline, not the cycle's lapsed close", async () => {
    const data = (await loadInternalCyclePortal(req(), "Interns", CYCLE_ID)) as any;
    expect(data.cycle.deadline).toBe(ENGS_CLOSE.toISOString());
  });

  it("shows the open domain's close for a draft whose picked domain has closed", async () => {
    mockPrisma.application.findFirst.mockResolvedValue({
      id: "app-1",
      answers: {},
      statusUpdates: [{ newStatus: "Draft" }],
      domainApplications: [{ id: "da-1", domainId: "web", selected: true }],
    });
    const data = (await loadInternalCyclePortal(req(), "Interns", CYCLE_ID)) as any;
    expect(data.cycle.deadline).toBe(ENGS_CLOSE.toISOString());
    expect(data.draft.selectedDomainIds).toEqual(["web"]);
  });

  it("gives each cycle in the chooser its latest open close", async () => {
    vi.mocked(getActiveCycles).mockResolvedValue([ACTIVE, { ...ACTIVE, id: "c2", name: "Winter", domains: [] }] as any);
    const data = (await loadInternalCyclePortal(req(), "Interns", undefined)) as any;
    expect(data.reason).toBe("choose-cycle");
    expect(data.cycles.map((c: any) => c.deadline)).toEqual([ENGS_CLOSE.toISOString(), CYCLE_CLOSE.toISOString()]);
  });
});
