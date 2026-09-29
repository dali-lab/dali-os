import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Dartmouth lookup module.
vi.mock("~/lib/dartmouth-lookup", () => ({
  bindNetIdByEmail: vi.fn(),
}));

// Mock the Prisma client.
vi.mock("~/lib/db", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { bindNetIdByEmail } from "~/lib/dartmouth-lookup";
import { prisma } from "~/lib/db";
import { captureDartmouthIdentity } from "~/lib/dartmouth-capture.server";

const mockBindNetId = vi.mocked(bindNetIdByEmail);
const mockUpdate = vi.mocked(prisma.user.update);

beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to create a fake DirectoryMatch
function makeMatch(netId: string): import("~/lib/dartmouth-lookup").DirectoryMatch {
  return {
    netId,
    mail: "jane.doe@dartmouth.edu",
    affiliation: "Student",
    departmentClass: "'27",
    classYear: 2027,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) lookup match → update includes netId + names + dartmouthEmail
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — lookup match", () => {
  it("writes netId, names, and dartmouthEmail when directory returns a match", async () => {
    mockBindNetId.mockResolvedValue(makeMatch("jdoe26"));
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
    mockBindNetId.mockResolvedValue(null);
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
    mockBindNetId.mockResolvedValue(makeMatch("taken-netid"));

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
    mockBindNetId.mockResolvedValue(makeMatch("some-netid"));
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
    mockBindNetId.mockResolvedValue(null);
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
    mockBindNetId.mockResolvedValue(null);
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
    mockBindNetId.mockResolvedValue(null);
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
// (e) lookup throws → swallowed, update still runs without netId
// ─────────────────────────────────────────────────────────────────────────────

describe("captureDartmouthIdentity — lookup throws", () => {
  it("swallows a lookup error and still writes names + dartmouthEmail without netId", async () => {
    mockBindNetId.mockRejectedValue(new Error("network error"));
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
