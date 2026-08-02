import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/cors", () => ({
  handlePreflight: () => null,
  withCors: (_req: Request, res: Response) => res,
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { action } from "~/admin/routes/api.domains";

const ADMIN_ID = "admin-1";

const mockPrisma = prisma as unknown as {
  domain: { create: ReturnType<typeof vi.fn> };
  groupDefinition: { upsert: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  (mockPrisma as any).domain = {
    create: vi.fn(async ({ data }: any) => ({
      id: "new",
      name: data.name,
      displayName: data.displayName,
    })),
  };
  // ensureDomainGroup runs after a successful create — stub the upsert so
  // the post-create hook resolves without touching a real DB.
  (mockPrisma as any).groupDefinition = {
    upsert: vi.fn(async () => ({})),
  };
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: ADMIN_ID, email: "a@x.com", type: "user" },
  } as any);
  vi.mocked(isAdmin).mockResolvedValue(true);
});

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/domains", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/domains — name validation", () => {
  it("accepts a normal name and trims it", async () => {
    const res = await action({
      request: makeRequest({ name: "  Design  " }),
      context: {},
    } as any);
    expect(res.status).toBe(201);
    expect(mockPrisma.domain.create).toHaveBeenCalledWith({
      data: { name: "Design", code: "Design", displayName: "Design" },
    });
  });

  it("rejects an empty name", async () => {
    const res = await action({
      request: makeRequest({ name: "" }),
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.domain.create).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only name", async () => {
    const res = await action({
      request: makeRequest({ name: "   " }),
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.domain.create).not.toHaveBeenCalled();
  });

  it("rejects a name longer than 100 characters", async () => {
    const res = await action({
      request: makeRequest({ name: "x".repeat(101) }),
      context: {},
    } as any);
    expect(res.status).toBe(400);
    expect(mockPrisma.domain.create).not.toHaveBeenCalled();
  });
});
