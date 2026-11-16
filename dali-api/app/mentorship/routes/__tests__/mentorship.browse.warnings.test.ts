import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  project: { findMany: vi.fn() },
  domain: { findMany: vi.fn() },
  term: { findMany: vi.fn() },
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
vi.mock("../../lib/warnings.server", () => ({ warningsEnabledFor: vi.fn(), openWarningMemberIds: vi.fn() }));

import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore, currentTerm } from "~/lib/roles";
import { canViewMentorship, mentorshipPairWhere, mentorNoteWhere } from "../../lib/visibility";
import { listSelectableForms } from "~/projects/lib/form-slots";
import { openWarningMemberIds, warningsEnabledFor } from "../../lib/warnings.server";
import { loader } from "../mentorship.browse";

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
  vi.mocked(openWarningMemberIds).mockResolvedValue(["m1", "m2"]);
});

describe("browse warned members", () => {
  it("returns the warned member ids when the warnings tab is enabled", async () => {
    vi.mocked(warningsEnabledFor).mockResolvedValue(true);
    const data = await run();
    expect(data.warningsEnabled).toBe(true);
    expect(data.warnedIds).toEqual(["m1", "m2"]);
  });

  it("shows nothing and skips the lookup when warnings aren't enabled for the viewer", async () => {
    vi.mocked(warningsEnabledFor).mockResolvedValue(false);
    const data = await run();
    expect(data.warningsEnabled).toBe(false);
    expect(data.warnedIds).toEqual([]);
    expect(openWarningMemberIds).not.toHaveBeenCalled();
  });
});
