import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    term: { findMany: vi.fn() },
    formVersion: { findFirst: vi.fn() },
    domain: { findMany: vi.fn() },
  },
}));
vi.mock("~/lib/db.server", () => ({ prisma: h.prisma }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), redirectNonMemberToPortal: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn(() => new Response(null, { status: 302 })) }));
vi.mock("~/lib/roles", () => ({
  canViewStaffing: vi.fn(),
  canManageStaffing: vi.fn(),
  currentTerm: vi.fn(),
}));
vi.mock("~/lib/terms", () => ({ resolveTermFilter: vi.fn() }));
vi.mock("../staffing-cycle", () => ({ ensureStaffingCycle: vi.fn() }));
vi.mock("../form-slots", () => ({
  getSlotBinding: vi.fn(),
  isGateAudience: vi.fn(),
  listSelectableForms: vi.fn(),
  setSlotBinding: vi.fn(),
  setSlotColumnMapping: vi.fn(),
  setSlotGate: vi.fn(),
  setSlotPublished: vi.fn(),
}));
vi.mock("../submission-view.server", () => ({ buildSubmissionView: vi.fn() }));
vi.mock("../slot-board.server", () => ({
  resolveBoardCycles: vi.fn(),
  setBoardColumn: vi.fn(),
  deleteBoardResponse: vi.fn(),
}));

import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { resolveTermFilter } from "~/lib/terms";
import { ensureStaffingCycle } from "../staffing-cycle";
import { getSlotBinding, setSlotBinding, setSlotColumnMapping, setSlotPublished } from "../form-slots";
import { buildSubmissionView } from "../submission-view.server";
import { resolveBoardCycles, setBoardColumn } from "../slot-board.server";
import { loadSlotBoard, redirectToBoardDetail, slotBoardAction } from "../slot-board-page.server";

const post = (fields: Record<string, string>, url = "http://os.test/core/level-up?term=t2") => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request(url, { method: "POST", body });
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(redirectNonMemberToPortal).mockResolvedValue(null as never);
  vi.mocked(canViewStaffing).mockResolvedValue(true);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(currentTerm).mockResolvedValue({ id: "t2", code: "26F" } as never);
  vi.mocked(resolveTermFilter).mockResolvedValue({
    terms: [{ id: "t2", code: "26F" }],
    termId: "t2",
  } as never);
  vi.mocked(ensureStaffingCycle).mockResolvedValue({ id: "c1" } as never);
});

describe("slotBoardAction", () => {
  it("refuses a non-manager before touching the cycle when managersOnly, even for an unknown intent", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    const res = await slotBoardAction(post({ intent: "nope" }), "project-bids", { managersOnly: true });
    expect(res.status).toBe(403);
    expect(ensureStaffingCycle).not.toHaveBeenCalled();
  });

  it("refuses a non-manager on a settings intent without managersOnly, but lets other intents through to the extras", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    const denied = await slotBoardAction(post({ intent: "set-slot-published", published: "1" }), "level-up");
    expect(denied.status).toBe(403);
    expect(setSlotPublished).not.toHaveBeenCalled();

    const extraIntent = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const res = await slotBoardAction(post({ intent: "custom" }), "level-up", { extraIntent });
    expect(extraIntent).toHaveBeenCalledWith("custom", expect.objectContaining({ userId: "u1" }));
    expect(await res.json()).toEqual({ ok: true });
  });

  it("answers an unknown intent with 400", async () => {
    const res = await slotBoardAction(post({ intent: "nope" }), "level-up");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown intent" });
  });

  it("is a 400 when there is no term to bind to", async () => {
    vi.mocked(currentTerm).mockResolvedValue(null as never);
    vi.mocked(resolveTermFilter).mockResolvedValue({ terms: [], termId: null } as never);
    const res = await slotBoardAction(post({ intent: "set-slot-form" }), "level-up");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No active staffing term." });
  });

  it("binds a form to the viewed term's cycle and reports the move", async () => {
    vi.mocked(setSlotBinding).mockResolvedValue({ ok: true, movedFrom: "26X" } as never);
    const res = await slotBoardAction(
      post({ intent: "set-slot-form", formId: "f1", allowMove: "1" }),
      "project-bids",
      { managersOnly: true },
    );
    expect(setSlotBinding).toHaveBeenCalledWith("c1", "project-bids", "f1", "u1", { allowMove: true });
    expect(await res.json()).toEqual({ ok: true, movedFrom: "26X" });
  });

  it("rejects mapping a slot with no bound form, and a malformed mapping", async () => {
    vi.mocked(getSlotBinding).mockResolvedValue(null);
    const none = await slotBoardAction(post({ intent: "set-slot-mapping", mapping: "{}" }), "level-up");
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "Bind a form before mapping its columns." });

    vi.mocked(getSlotBinding).mockResolvedValue({ formId: "f1" } as never);
    const bad = await slotBoardAction(post({ intent: "set-slot-mapping", mapping: "not json" }), "level-up");
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Invalid mapping." });
  });

  it("routes column edits to the board helper", async () => {
    vi.mocked(setBoardColumn).mockResolvedValue(Response.json({ ok: true }));
    await slotBoardAction(post({ intent: "set-slot-column", op: "{}" }), "level-up");
    expect(setBoardColumn).toHaveBeenCalledWith(expect.any(FormData), "c1", "level-up", "u1");
  });

  it("rejects an invalid published flag result", async () => {
    vi.mocked(setSlotPublished).mockResolvedValue({ ok: false, error: "No form" } as never);
    const res = await slotBoardAction(post({ intent: "set-slot-published", published: "1" }), "level-up");
    expect(res.status).toBe(400);
    expect(setSlotColumnMapping).not.toHaveBeenCalled();
  });
});

describe("loadSlotBoard", () => {
  const view = {
    rows: [{ userId: "u9", name: "Ada" }],
    tableColumns: [],
  };

  beforeEach(() => {
    vi.mocked(resolveBoardCycles).mockResolvedValue({
      termOptions: [],
      selectedTerm: "t2",
      isAll: false,
      cycleIds: ["c1"],
      cycleName: "26F",
      singleCycleId: "c1",
    } as never);
    vi.mocked(getSlotBinding).mockResolvedValue(null);
    vi.mocked(buildSubmissionView).mockResolvedValue(view as never);
    h.prisma.domain.findMany.mockResolvedValue([]);
    h.prisma.term.findMany.mockResolvedValue([{ id: "t2", code: "26F" }]);
  });

  const req = new Request("http://os.test/core/level-up");

  it("sends a signed-out visitor to login and a non-viewer home", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false } as never);
    expect((await loadSlotBoard(req, "level-up")) as Response).toHaveProperty("status", 302);

    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(canViewStaffing).mockResolvedValue(false);
    const res = (await loadSlotBoard(req, "level-up")) as Response;
    expect(res.headers.get("Location")).toBe("/");
  });

  it("reports no cycle when none resolves", async () => {
    vi.mocked(resolveBoardCycles).mockResolvedValue(null);
    expect(await loadSlotBoard(req, "level-up")).toEqual({ gate: "no-cycle" });
  });

  it("flags a single-term board with no bound form", async () => {
    const data = await loadSlotBoard(req, "level-up");
    expect(data).toMatchObject({ gate: "ok", noFormConnected: true, canManage: true, allTerms: [] });
    expect(h.prisma.term.findMany).not.toHaveBeenCalled();
  });

  it("reads the term list only when asked, and runs the row enricher", async () => {
    const enrichRows = vi.fn(async (rows: { userId: string }[]) => rows.map((r) => ({ ...r, extra: 1 })));
    const data = await loadSlotBoard(req, "intent-to-work", {
      withTermColumns: true,
      enrichRows: enrichRows as never,
    });
    expect(enrichRows).toHaveBeenCalledWith(view.rows, { cycleIds: ["c1"], binding: null });
    expect(data).toMatchObject({
      allTerms: [{ id: "t2", code: "26F" }],
      submissions: [{ userId: "u9", extra: 1 }],
    });
  });
});

describe("redirectToBoardDetail", () => {
  it("opens the member's drawer on the board, keeping the other query params", async () => {
    const res = (await redirectToBoardDetail(
      new Request("http://os.test/core/project-bids/u9?term=t-26s"),
      "project-bids",
      "u9",
    )) as Response;
    const url = new URL(res.headers.get("Location")!, "http://os.test");
    expect(url.pathname).toBe("/core/project-bids");
    expect(url.searchParams.get("term")).toBe("t-26s");
    expect(url.searchParams.get("open")).toBe("u9");
  });
});
