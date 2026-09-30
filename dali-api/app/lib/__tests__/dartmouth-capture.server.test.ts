import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock only the network call; DartmouthEmailApiError must stay real so the
// capture path's `instanceof` check distinguishes an unreachable API from a
// person the API simply has no record of.
vi.mock("~/lib/dartmouth-email-addresses", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/lib/dartmouth-email-addresses")>();
  return { ...actual, findNetIdByAddress: vi.fn() };
});

// Mock the Prisma client.
vi.mock("~/lib/db", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
    userEmail: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
  },
}));

import {
  findNetIdByAddress,
  DartmouthEmailApiError,
} from "~/lib/dartmouth-email-addresses";
import { prisma } from "~/lib/db";
import { captureDartmouthIdentity } from "~/lib/dartmouth-capture.server";

const mockFindNetId = vi.mocked(findNetIdByAddress);
const mockUpdate = vi.mocked(prisma.user.update);

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// (a) lookup match → update includes netId + names + dartmouthEmail
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — lookup match", () => {
  it("writes netId, names, and dartmouthEmail when directory returns a match", async () => {
    mockFindNetId.mockResolvedValue("jdoe26");
    mockUpdate.mockResolvedValue({} as never);

    const result = await captureDartmouthIdentity({
      userId: "user-1",
      fullName: "Jane Doe",
      verifiedEmail: "Jane.Doe@Dartmouth.edu",
    });

    expect(result).toEqual({ netIdCaptured: true });
    expect(mockUpdate).toHaveBeenCalledOnce();
    const [call] = mockUpdate.mock.calls;
    expect(call[0].where).toEqual({ id: "user-1" });
    expect(call[0].data).toMatchObject({
      firstName: "Jane",
      lastName: "Doe",
      dartmouthEmail: "jane.doe@dartmouth.edu",
      netId: "jdoe26",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) lookup miss (null) → update sets names + dartmouthEmail, NO netId
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — lookup miss", () => {
  it("writes names and dartmouthEmail but not netId when directory returns null", async () => {
    mockFindNetId.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({} as never);

    const result = await captureDartmouthIdentity({
      userId: "user-2",
      fullName: "Robin Smith",
      verifiedEmail: "robin.smith@dartmouth.edu",
    });

    expect(result).toEqual({ netIdCaptured: false });
    expect(mockUpdate).toHaveBeenCalledOnce();
    const [call] = mockUpdate.mock.calls;
    expect(call[0].data).not.toHaveProperty("netId");
    expect(call[0].data).toMatchObject({
      firstName: "Robin",
      lastName: "Smith",
      dartmouthEmail: "robin.smith@dartmouth.edu",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) P2002 on the netId write → retries without netId and still succeeds
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — P2002 collision", () => {
  it("retries without netId on a unique-constraint violation and returns netIdCaptured: false", async () => {
    mockFindNetId.mockResolvedValue("taken-netid");

    const p2002 = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
    });

    // First update throws P2002, second (without netId) succeeds.
    mockUpdate
      .mockRejectedValueOnce(p2002)
      .mockResolvedValueOnce({} as never);

    const result = await captureDartmouthIdentity({
      userId: "user-3",
      fullName: "Alex Jones",
      verifiedEmail: "alex.j@dartmouth.edu",
    });

    expect(result).toEqual({ netIdCaptured: false });
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    // First call should include netId.
    expect(mockUpdate.mock.calls[0][0].data).toHaveProperty("netId", "taken-netid");
    // Second (retry) call should NOT include netId.
    expect(mockUpdate.mock.calls[1][0].data).not.toHaveProperty("netId");
    expect(mockUpdate.mock.calls[1][0].data).toMatchObject({
      firstName: "Alex",
      lastName: "Jones",
      dartmouthEmail: "alex.j@dartmouth.edu",
    });
  });

  it("re-throws errors that are NOT P2002", async () => {
    mockFindNetId.mockResolvedValue("some-netid");
    const dbDown = Object.assign(new Error("Connection lost"), { code: "P2001" });
    mockUpdate.mockRejectedValue(dbDown);

    await expect(
      captureDartmouthIdentity({
        userId: "user-4",
        fullName: "Someone Else",
        verifiedEmail: "someone@dartmouth.edu",
      }),
    ).rejects.toThrow("Connection lost");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) name splitting
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — name splitting", () => {
  it("splits 'Ada Lovelace' into first='Ada', last='Lovelace'", async () => {
    mockFindNetId.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({} as never);

    await captureDartmouthIdentity({
      userId: "u",
      fullName: "Ada Lovelace",
      verifiedEmail: "ada@dartmouth.edu",
    });

    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("single-token name → lastName is empty string", async () => {
    mockFindNetId.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({} as never);

    await captureDartmouthIdentity({
      userId: "u",
      fullName: "Cher",
      verifiedEmail: "cher@dartmouth.edu",
    });

    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      firstName: "Cher",
      lastName: "",
    });
  });

  it("multi-word last name: 'Ada van der Berg' → first='Ada', last='van der Berg'", async () => {
    mockFindNetId.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({} as never);

    await captureDartmouthIdentity({
      userId: "u",
      fullName: "Ada van der Berg",
      verifiedEmail: "ada@dartmouth.edu",
    });

    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      firstName: "Ada",
      lastName: "van der Berg",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) lookup throws → reported, update still runs without netId
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — lookup throws", () => {
  it("reports a lookup error and still writes names + dartmouthEmail without netId", async () => {
    mockFindNetId.mockRejectedValue(new Error("network error"));
    mockUpdate.mockResolvedValue({} as never);

    const result = await captureDartmouthIdentity({
      userId: "user-5",
      fullName: "Pat Riley",
      verifiedEmail: "pat.riley@dartmouth.edu",
    });

    expect(result).toEqual({ netIdCaptured: false });
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockUpdate.mock.calls[0][0].data).not.toHaveProperty("netId");
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({
      firstName: "Pat",
      lastName: "Riley",
      dartmouthEmail: "pat.riley@dartmouth.edu",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (f) the proven address is recorded, and an unreachable directory is loud
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — address + directory reachability", () => {
  it("records the magic-link address as a proven alias before consulting the directory", async () => {
    mockFindNetId.mockResolvedValue(null);
    mockUpdate.mockResolvedValue({} as never);

    await captureDartmouthIdentity({
      userId: "user-6",
      fullName: "Jane Doe",
      verifiedEmail: "Jane.Doe@Dartmouth.edu",
    });

    expect(prisma.userEmail.create).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.userEmail.create).mock.calls[0][0] as {
      data: { userId: string; address: string; verifiedAt: Date | null };
    };
    expect(arg.data.userId).toBe("user-6");
    expect(arg.data.address).toBe("jane.doe@dartmouth.edu");
    // The link proved this mailbox, so it is verified — unlike a CAS-synthesized
    // alias or a directory attestation, which only say where mail lands.
    expect(arg.data.verifiedAt).toBeInstanceOf(Date);
  });

  it("distinguishes an unreachable API from a person with no netID", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindNetId.mockRejectedValue(
      new DartmouthEmailApiError(
        "dartmouth-email-addresses: HTTP 403 — is email_addresses:read.adv granted?",
      ),
    );
    mockUpdate.mockResolvedValue({} as never);

    const result = await captureDartmouthIdentity({
      userId: "user-7",
      fullName: "Pat Riley",
      verifiedEmail: "pat.riley@dartmouth.edu",
    });

    expect(result).toEqual({ netIdCaptured: false });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("email API unavailable"),
      expect.any(String),
    );
    spy.mockRestore();
  });
});
