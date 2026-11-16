import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  project: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  term: { findMany: vi.fn() },
  mentorshipWarning: { findMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), currentTerm: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("../../lib/visibility", () => ({
  canViewMentorship: vi.fn(),
  mentorshipPairWhere: vi.fn(),
  mentorNoteWhere: vi.fn(),
}));
vi.mock("../../lib/term-forms.server", () => ({ loadTermForms: vi.fn(), setTermForm: vi.fn() }));
vi.mock("~/projects/lib/form-slots", () => ({ listSelectableForms: vi.fn() }));
vi.mock("../../lib/warnings.server", () => ({ warningsEnabledFor: vi.fn() }));

import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { canViewMentorship, mentorshipPairWhere, mentorNoteWhere } from "../../lib/visibility";
import { listSelectableForms } from "~/projects/lib/form-slots";
import { warningsEnabledFor } from "../../lib/warnings.server";
import { loader } from "../mentorship.browse";

const ada = { id: "m1", name: "", firstName: "Ada", lastName: "Lovelace", photoUrl: null };
const open = [
  { memberId: "m1", reason: "missed_lab", member: ada },
  { memberId: "m1", reason: "other", member: ada },
  { memberId: "m2", reason: "missed_meeting", member: { ...ada, id: "m2", name: "Grace H" } },
];

const run = () => loader({ request: new Request("http://localhost/mentorship/browse?mock=0") } as never) as Promise<any>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "core1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(canViewMentorship).mockResolvedValue(true);
  vi.mocked(mentorshipPairWhere).mockResolvedValue({} as never);
  vi.mocked(mentorNoteWhere).mockResolvedValue({} as never);
  vi.mocked(currentTerm).mockResolvedValue(null as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(listSelectableForms).mockResolvedValue([]);
  db.project.findMany.mockResolvedValue([]);
  db.domain.findMany.mockResolvedValue([]);
  db.term.findMany.mockResolvedValue([]);
  db.user.findUnique.mockResolvedValue(null);
  db.mentorshipWarning.findMany.mockResolvedValue(open);
});

describe("browse open warnings", () => {
  it("lists one entry per warned member when the warnings tab is enabled", async () => {
    vi.mocked(warningsEnabledFor).mockResolvedValue(true);
    const data = await run();
    expect(data.warningsEnabled).toBe(true);
    expect(db.mentorshipWarning.findMany.mock.calls[0][0].where).toEqual({ status: "open" });
    expect(data.warned).toEqual([
      { id: "m1", name: "Ada Lovelace", photoUrl: null, count: 2, latestReason: "missed_lab" },
      { id: "m2", name: "Grace H", photoUrl: null, count: 1, latestReason: "missed_meeting" },
    ]);
  });

  it("shows nothing and skips the query when warnings aren't enabled for the viewer", async () => {
    vi.mocked(warningsEnabledFor).mockResolvedValue(false);
    const data = await run();
    expect(data.warningsEnabled).toBe(false);
    expect(data.warned).toEqual([]);
    expect(db.mentorshipWarning.findMany).not.toHaveBeenCalled();
  });

  it("has an empty list when no warnings are open", async () => {
    vi.mocked(warningsEnabledFor).mockResolvedValue(true);
    db.mentorshipWarning.findMany.mockResolvedValue([]);
    expect((await run()).warned).toEqual([]);
  });
});
