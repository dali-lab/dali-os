import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: { page: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireMemberSession: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/pages", () => ({ createLabPage: vi.fn(), pageDepth: vi.fn(), MAX_PAGE_DEPTH: 6 }));
vi.mock("~/lib/pageAccess.server", () => ({ getPageAccess: vi.fn(), isUnderGoverningScope: vi.fn() }));

import { requireMemberSession } from "~/lib/auth";
import { createLabPage } from "~/lib/pages";
import { PageNameConflictError } from "~/lib/page-names.server";
import { action } from "../api.lab-documents";

const post = (body: unknown) =>
  action({
    request: new Request("http://x/api/lab-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireMemberSession).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
});

describe("POST /api/lab-documents names", () => {
  it("creates the page when the name is free", async () => {
    vi.mocked(createLabPage).mockResolvedValue({ id: "new" });
    const res = await post({ title: "Plans" });
    expect(await res.json()).toEqual({ id: "new" });
  });

  it("409s with the clash message when the name is taken", async () => {
    vi.mocked(createLabPage).mockRejectedValue(new PageNameConflictError("A folder named “Plans” already exists here"));
    const res = await post({ title: "Plans", kind: "Folder" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A folder named “Plans” already exists here" });
  });

  it("does not swallow other failures", async () => {
    vi.mocked(createLabPage).mockRejectedValue(new Error("db down"));
    await expect(post({ title: "Plans" })).rejects.toThrow("db down");
  });
});
