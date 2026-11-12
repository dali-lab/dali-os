import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const requireMobileUser = vi.fn();
const currentTerm = vi.fn();
const resolveWalletPassFields = vi.fn();
const ensureWalletSecret = vi.fn();

vi.mock("~/lib/mobile-auth.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/mobile-auth.server")>()),
  requireMobileUser: (...a: unknown[]) => requireMobileUser(...a),
}));
vi.mock("~/lib/roles", () => ({ currentTerm: (...a: unknown[]) => currentTerm(...a) }));
vi.mock("~/lib/wallet-pass-fields.server", () => ({
  resolveWalletPassFields: (...a: unknown[]) => resolveWalletPassFields(...a),
}));
vi.mock("~/lib/wallet-token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/wallet-token")>()),
  ensureWalletSecret: (...a: unknown[]) => ensureWalletSecret(...a),
}));

import { mockedPrisma } from "~/test-utils/prisma";
import { verifyWalletToken } from "~/lib/wallet-token";
import { loader } from "../api.mobile.pass";

const db = mockedPrisma();
const load = () =>
  loader({ request: new Request("https://os.example/api/mobile/pass") } as never) as Promise<Response>;

const fields = { name: "Ada Lovelace", memberSinceTerm: "25F", isCore: true, domainCode: "DES" };
const SECRET = "member-secret";

beforeEach(() => {
  vi.resetAllMocks();
  process.env.WALLET_PASS_SECRET = "global-signing-key";
  requireMobileUser.mockResolvedValue({ ok: true, userId: "user-abcd1234" });
  resolveWalletPassFields.mockResolvedValue(fields);
  ensureWalletSecret.mockResolvedValue(SECRET);
  currentTerm.mockResolvedValue({ endDate: new Date("2026-11-20T12:00:00Z") });
  db.meetingAttendance.findMany.mockResolvedValue([] as never);
});
afterEach(() => {
  delete process.env.WALLET_PASS_SECRET;
});

describe("GET /api/mobile/pass", () => {
  it("passes the guard failure response through", async () => {
    const denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    requireMobileUser.mockResolvedValue({ ok: false, response: denied });
    expect(await load()).toBe(denied);
    expect(ensureWalletSecret).not.toHaveBeenCalled();
  });

  it("returns 503 without minting a secret when wallet tokens are not configured", async () => {
    delete process.env.WALLET_PASS_SECRET;
    const res = await load();
    expect(res.status).toBe(503);
    expect(ensureWalletSecret).not.toHaveBeenCalled();
    expect(db.meetingAttendance.findMany).not.toHaveBeenCalled();
  });

  it("queries the 20 most recent present check-ins for the user", async () => {
    await load();
    expect(db.meetingAttendance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-abcd1234", present: true },
        take: 20,
        orderBy: [{ markedAt: "desc" }, { occurrenceStart: "desc" }],
      }),
    );
  });

  it("locks the response key set and values", async () => {
    db.meetingAttendance.findMany.mockResolvedValue([
      {
        id: "a1",
        markedAt: new Date("2026-10-20T14:00:00Z"),
        occurrenceStart: new Date("2026-10-20T13:00:00Z"),
        meeting: { title: "Weekly", location: "Baker 101", rooms: [] },
      },
    ] as never);
    const res = await load();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["accessLevel", "checkIns", "memberSince", "name", "passId", "qrPayload", "validThrough"].sort(),
    );
    expect(Object.keys(body.checkIns[0]).sort()).toEqual(["at", "id", "location"]);
    expect(body.passId).toBe("DALI-25F-1234");
    expect(body.name).toBe("Ada Lovelace");
    expect(body.memberSince).toBe("25F");
    expect(body.accessLevel).toBe("Core · DES");
    expect(body.validThrough).toBe("Nov 20, 2026");
    expect(body.checkIns).toEqual([{ id: "a1", location: "Baker 101", at: "2026-10-20T14:00:00.000Z" }]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns a qrPayload that verifies against the member secret", async () => {
    const body = await (await load()).json();
    expect(verifyWalletToken(body.qrPayload, SECRET)).toEqual({ ok: true, memberId: "user-abcd1234" });
    expect(verifyWalletToken(body.qrPayload, "other-secret")).toEqual({ ok: false });
  });

  it("returns validThrough null with no current term", async () => {
    currentTerm.mockResolvedValue(null);
    expect((await (await load()).json()).validThrough).toBeNull();
  });

  it("falls back to occurrenceStart when a check-in has no markedAt", async () => {
    db.meetingAttendance.findMany.mockResolvedValue([
      {
        id: "a2",
        markedAt: null,
        occurrenceStart: new Date("2026-10-21T13:00:00Z"),
        meeting: { title: "Studio", location: null, rooms: [{ name: "Room A" }, { name: "Room B" }] },
      },
    ] as never);
    const body = await (await load()).json();
    expect(body.checkIns).toEqual([{ id: "a2", location: "Room A, Room B", at: "2026-10-21T13:00:00.000Z" }]);
  });
});
