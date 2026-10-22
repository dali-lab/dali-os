import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    rubricVersion: { findFirst: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/auth", () => ({ requireCoreOrDomainLead: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/collab-token.server", () => ({ getCollabToken: vi.fn() }));
vi.mock("~/hiring/components/RubricDetail", () => ({ RubricDetail: () => null }));

import { prisma } from "~/lib/db";
import { requireCoreOrDomainLead } from "~/lib/auth";
import { logAuditEvent } from "~/lib/audit";
import { action } from "~/hiring/routes/rubrics.$id";

function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/hiring/rubrics/r1", { method: "POST", body }),
    params: { id: "r1" },
    context: {},
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireCoreOrDomainLead).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: "u1" } as never);
  vi.mocked(prisma.rubricVersion.findFirst).mockResolvedValue({ versionNumber: 2 } as never);
  vi.mocked(prisma.rubricVersion.create).mockResolvedValue({ id: "rv3" } as never);
});

describe("rubrics.$id action", () => {
  it("logs the new version with its number and criteria count", async () => {
    await submit({ intent: "create-version", criteria: JSON.stringify([{ key: "a" }, { key: "b" }]) });

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rubric.version.create",
        userId: "u1",
        targetId: "rv3",
        metadata: { rubricId: "r1", versionNumber: 3, criteriaCount: 2 },
      }),
    );
  });

  it("logs nothing for other intents or when the gate refuses", async () => {
    await submit({ intent: "other" });
    vi.mocked(requireCoreOrDomainLead).mockResolvedValue({ ok: false, response: new Response("no", { status: 403 }) } as never);
    await submit({ intent: "create-version", criteria: "[]" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
