import { beforeEach, expect, it, vi } from "vitest";
vi.mock("~/lib/db", () => ({ prisma: {
  partnerApplication: { findMany: vi.fn() },
  term: { findMany: vi.fn() }, domain: { findMany: vi.fn() },
  partnerCrmSettings: { findUnique: vi.fn() },
} }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("../../components/PartnerBoard", () => ({ PartnerBoard: () => null }));
vi.mock("../../components/PartnerApplicationModal", () => ({ PartnerApplicationModal: () => null }));
vi.mock("../../components/PartnerSettingsModal", () => ({ PartnerSettingsModal: () => null }));
vi.mock("../../components/PartnerCrmNav", () => ({ PartnerCrmNav: () => null }));
import { prisma } from "~/lib/db";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { loader } from "../core.partners";

function load() {
  return loader({ request: new Request("http://localhost/core/partners"), params: {}, context: {} } as never);
}

const now = new Date("2026-10-01T00:00:00Z");
const application = {
  id: "app", title: "Project", stage: "New", position: 0, resultingProjectId: null, source: "Form",
  feeCents: 1200000, nextStep: null, nextStepDueAt: null, lastActivityAt: now, holdUntil: null,
  meetingRequestedAt: null, createdAt: now,
  partnerOrg: null, applicantContact: { name: "Ada" },
  targetTerms: [{ term: { id: "26F", code: "26F" } }],
  domains: [{ domainId: "dev", expectedMembers: 3, domain: { displayName: "Dev" } }],
  meetings: [], meetingRequests: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "26F", startDate: now } as never);
  vi.mocked(prisma.partnerApplication.findMany).mockResolvedValue([application] as never);
  vi.mocked(prisma.term.findMany).mockResolvedValue([]);
  vi.mocked(prisma.domain.findMany).mockResolvedValue([]);
  vi.mocked(prisma.partnerCrmSettings.findUnique).mockResolvedValue(null);
});

it("maps fee, target terms and per-domain spots onto the card", async () => {
  expect(await load()).toMatchObject({
    cards: [{
      id: "app", feeCents: 1200000, orgName: null, contactName: "Ada",
      targetTerms: [{ id: "26F", code: "26F" }],
      domains: [{ id: "dev", name: "Dev", expectedMembers: 3 }],
    }],
    currentTermStartIso: now.toISOString(),
    staleDays: 14,
  });
});

it("uses the saved stale threshold", async () => {
  vi.mocked(prisma.partnerCrmSettings.findUnique).mockResolvedValue({ staleDays: 7 } as never);
  expect(await load()).toMatchObject({ staleDays: 7 });
});

it("excludes Renewal applications from the board", async () => {
  await load();
  expect(prisma.partnerApplication.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { source: { not: "Renewal" } } }),
  );
});

it("redirects unauthorized visitors before loading applications", async () => {
  vi.mocked(requireAuth).mockResolvedValueOnce({ ok: false } as never);
  expect(await load()).toBeInstanceOf(Response);
  vi.mocked(isNonMember).mockResolvedValueOnce(true);
  expect((await load() as Response).headers.get("Location")).toBe("/portal");
  vi.mocked(isCore).mockResolvedValueOnce(false);
  expect((await load() as Response).headers.get("Location")).toBe("/");
  expect(prisma.partnerApplication.findMany).not.toHaveBeenCalled();
});
