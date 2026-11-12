import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ canViewStaffing: vi.fn() }));
vi.mock("~/projects/lib/form-slots", () => ({
  getSlotBinding: vi.fn(),
  isSlot: (v: string) => ["project-bids", "intent-to-work", "level-up"].includes(v),
}));
vi.mock("~/projects/lib/slot-board.server", () => ({ resolveBoardCycles: vi.fn() }));
vi.mock("~/projects/lib/submission-view.server", () => ({ buildSubmissionView: vi.fn() }));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canViewStaffing } from "~/lib/roles";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { resolveBoardCycles } from "~/projects/lib/slot-board.server";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { loader } from "~/core/routes/core.board-export.csv";

const call = (query: string) =>
  loader({ request: new Request(`http://os.test/core/board-export.csv?${query}`) } as never) as Promise<Response>;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canViewStaffing).mockResolvedValue(true);
  vi.mocked(resolveBoardCycles).mockResolvedValue({
    termOptions: [],
    selectedTerm: "t2",
    isAll: false,
    cycleIds: ["c1"],
    cycleName: "26F",
    singleCycleId: "c1",
  });
  vi.mocked(getSlotBinding).mockResolvedValue({ formId: "f1" } as never);
  vi.mocked(buildSubmissionView).mockResolvedValue({
    tableColumns: [{ key: "builtin:termsInLab", label: "Terms in lab" }],
    rows: [
      { userId: "u1", name: "Ada Lovelace", email: "ada@example.edu", domainIds: ["eng"], cells: { "builtin:termsInLab": "2 terms: 26W, 26F" } },
      { userId: "u2", name: "Grace Hopper", email: null, domainIds: ["des"], cells: {} },
    ],
  } as never);
});

describe("board export.csv", () => {
  it("sends someone who can't view staffing away", async () => {
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    const res = await call("slot=project-bids");
    expect(res.status).toBe(302);
    expect(buildSubmissionView).not.toHaveBeenCalled();
  });

  it("rejects an unknown board", async () => {
    expect((await call("slot=payroll")).status).toBe(400);
  });

  it("exports the board's visible columns for the term's binding without creating a cycle", async () => {
    const res = await call("slot=project-bids&term=t2");
    expect(resolveBoardCycles).toHaveBeenCalledWith(expect.any(Request), { create: false });
    expect(buildSubmissionView).toHaveBeenCalledWith({ cycleIds: ["c1"], slot: "project-bids", formId: "f1" });
    expect(res.headers.get("Content-Disposition")).toMatch(/project-bids-26f-\d{4}-\d{2}-\d{2}\.csv/);
    expect(await res.text()).toBe(
      'Member,Email,Terms in lab\r\nAda Lovelace,ada@example.edu,"2 terms: 26W, 26F"\r\nGrace Hopper,,\r\n',
    );
  });

  it("applies the board's search and filters", async () => {
    const res = await call("slot=project-bids&domain=des");
    expect(await res.text()).toBe("Member,Email,Terms in lab\r\nGrace Hopper,,\r\n");
  });

  it("reads no binding for all terms", async () => {
    vi.mocked(resolveBoardCycles).mockResolvedValue({
      termOptions: [],
      selectedTerm: "all",
      isAll: true,
      cycleIds: ["c1", "c2"],
      cycleName: "all terms",
      singleCycleId: null,
    });
    const res = await call("slot=level-up&term=all");
    expect(getSlotBinding).not.toHaveBeenCalled();
    expect(buildSubmissionView).toHaveBeenCalledWith({ cycleIds: ["c1", "c2"], slot: "level-up", formId: null });
    expect(res.headers.get("Content-Disposition")).toMatch(/level-up-all-terms-/);
  });
});
