import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { gmailIntegration: { update: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/gmail-integration", () => ({ listSenderIntegrations: vi.fn() }));
vi.mock("~/email/lib/categories.server", () => ({
  CATEGORY_INTENTS: ["save-category", "delete-category"],
  handleInboxCategoryAction: vi.fn(async () => Response.json({ ok: true })),
  loadInboxCategories: vi.fn(),
}));

import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { handleInboxCategoryAction } from "~/email/lib/categories.server";
import { action } from "~/admin/routes/admin.email-senders";

const update = vi.mocked(prisma.gmailIntegration.update);

function submit(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/admin/messaging/senders", { method: "POST", body }),
    params: {},
    context: {},
  } as never) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isCore).mockResolvedValue(true);
  vi.mocked(isAdmin).mockResolvedValue(true);
});

describe("admin.email-senders action", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["0", null],
    ["-5", null],
    ["250", 250],
  ])("save-cap %j stores %j", async (raw, cap) => {
    await submit({ intent: "save-cap", id: "g1", dailyCap: raw });
    expect(update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { dailyCap: cap } });
  });

  it("disable soft-disables the row", async () => {
    await submit({ intent: "disable", id: "g1" });
    expect(update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { enabled: false } });
  });

  it("needs an id for disable and save-cap", async () => {
    expect((await submit({ intent: "disable" })).status).toBe(400);
    expect((await submit({ intent: "save-cap", dailyCap: "5" })).status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("limits category changes to admins", async () => {
    vi.mocked(isAdmin).mockResolvedValue(false);
    expect((await submit({ intent: "save-category" })).status).toBe(403);
    expect(handleInboxCategoryAction).not.toHaveBeenCalled();
  });

  it("is Core-only", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect((await submit({ intent: "disable", id: "g1" })).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
});
