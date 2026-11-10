import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: { project: { findUnique: vi.fn() }, page: { findUnique: vi.fn() } } }));
vi.mock("~/lib/auth", () => ({ requireProjectEditAccess: vi.fn() }));
vi.mock("~/lib/cors", () => ({ withCors: (_r: Request, res: Response) => res, handlePreflight: () => null }));
vi.mock("~/lib/pages", () => ({ createProjectPage: vi.fn(), pageDepth: vi.fn(), MAX_PAGE_DEPTH: 6 }));

import { prisma } from "~/lib/db.server";
import { requireProjectEditAccess } from "~/lib/auth";
import { createProjectPage } from "~/lib/pages";
import { PageNameConflictError } from "~/lib/page-names.server";
import { action } from "../api.projects.$id.documents";

const post = (body: unknown) =>
  action({
    request: new Request("http://x/api/projects/p1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id: "p1" },
  } as any);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireProjectEditAccess).mockResolvedValue({ ok: true, auth: { user: { sub: "u1" } } } as any);
  (prisma as any).project.findUnique.mockResolvedValue({ id: "p1" });
});

describe("POST /api/projects/:id/documents names", () => {
  it("creates the page when the name is free", async () => {
    vi.mocked(createProjectPage).mockResolvedValue({ id: "new" });
    expect(await (await post({ title: "Plans" })).json()).toEqual({ id: "new" });
  });

  it("409s with the clash message when the name is taken", async () => {
    vi.mocked(createProjectPage).mockRejectedValue(
      new PageNameConflictError("A document named “Plans” already exists here"),
    );
    const res = await post({ title: "Plans" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A document named “Plans” already exists here" });
  });
});
