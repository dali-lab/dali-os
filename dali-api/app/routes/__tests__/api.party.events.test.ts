import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/db");

import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { action } from "~/routes/api.party.events";

const USER_ID = "user-1";

const mockPrisma = prisma as unknown as {
  partyEvent: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/party/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: USER_ID, email: "u@x.com", type: "applicant" },
  } as any);
  mockPrisma.partyEvent.create.mockResolvedValue({} as any);
  mockPrisma.partyEvent.findFirst.mockResolvedValue(null);
});

describe("POST /api/party/events", () => {
  it("requires auth", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    const res = await action({
      request: makeRequest({ eventType: "PARTY_VISIT" }),
    });
    expect(res.status).toBe(401);
    expect(mockPrisma.partyEvent.create).not.toHaveBeenCalled();
  });

  it("rejects unknown event types", async () => {
    const res = await action({
      request: makeRequest({ eventType: "NOT_A_REAL_EVENT" }),
    });
    expect(res.status).toBe(400);
    expect(mockPrisma.partyEvent.create).not.toHaveBeenCalled();
  });

  it("rejects non-string event types", async () => {
    const res = await action({
      request: makeRequest({ eventType: 42 }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-POST methods", async () => {
    const res = await action({
      request: new Request("http://localhost/api/party/events", { method: "GET" }),
    });
    expect(res.status).toBe(405);
  });

  it("writes event row with server-derived userId and audience", async () => {
    const res = await action({
      request: makeRequest({ eventType: "CODE_UNLOCK_SUCCESS" }),
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.partyEvent.create).toHaveBeenCalledWith({
      data: {
        userId: USER_ID,
        audience: "applicant",
        eventType: "CODE_UNLOCK_SUCCESS",
        metadata: undefined,
      },
    });
  });

  it("derives audience=member when auth user type is member", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { sub: USER_ID, email: "u@x.com", type: "member" },
    } as any);
    await action({
      request: makeRequest({ eventType: "PARTY_VISIT" }),
    });
    const arg = mockPrisma.partyEvent.create.mock.calls[0][0];
    expect(arg.data.audience).toBe("member");
  });

  it("ignores client-supplied userId attempts", async () => {
    await action({
      request: makeRequest({
        eventType: "PARTY_VISIT",
        userId: "spoofed-user",
        audience: "member",
      }),
    });
    const arg = mockPrisma.partyEvent.create.mock.calls[0][0];
    expect(arg.data.userId).toBe(USER_ID);
    expect(arg.data.audience).toBe("applicant");
  });

  it("dedupes PARTY_VISIT when a recent row exists", async () => {
    mockPrisma.partyEvent.findFirst.mockResolvedValue({ id: "existing" } as any);
    const res = await action({
      request: makeRequest({ eventType: "PARTY_VISIT" }),
    });
    expect(res.status).toBe(200);
    expect(mockPrisma.partyEvent.create).not.toHaveBeenCalled();
  });

  it("does not dedupe non-visit events", async () => {
    mockPrisma.partyEvent.findFirst.mockResolvedValue({ id: "existing" } as any);
    await action({
      request: makeRequest({ eventType: "CODE_UNLOCK_FAILURE" }),
    });
    expect(mockPrisma.partyEvent.create).toHaveBeenCalled();
  });

  it("preserves object metadata", async () => {
    await action({
      request: makeRequest({
        eventType: "CODE_UNLOCK_SUCCESS",
        metadata: { audience: "member" },
      }),
    });
    const arg = mockPrisma.partyEvent.create.mock.calls[0][0];
    expect(arg.data.metadata).toEqual({ audience: "member" });
  });

  it("drops non-object metadata", async () => {
    await action({
      request: makeRequest({
        eventType: "CODE_UNLOCK_SUCCESS",
        metadata: "not an object",
      }),
    });
    const arg = mockPrisma.partyEvent.create.mock.calls[0][0];
    expect(arg.data.metadata).toBeUndefined();
  });
});
