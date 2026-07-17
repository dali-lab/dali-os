import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import { runFormsAction } from "~/forms/lib/forms-data";

const mockPrisma = prisma as unknown as {
  form: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  groupDefinition: { findMany: ReturnType<typeof vi.fn> };
  term: { findMany: ReturnType<typeof vi.fn> };
};

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.form.findUnique.mockResolvedValue({ id: "form-1" });
  mockPrisma.term.findMany.mockResolvedValue([]);
});

describe("runFormsAction update-form-audience", () => {
  it("sets a non-Groups audience and clears any stored group ids", async () => {
    const res = await runFormsAction(
      fd({ intent: "update-form-audience", id: "form-1", audience: "Public" }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { audience: "Public", audienceGroupIds: [] },
    });
    // No group validation needed off the Groups path.
    expect(mockPrisma.groupDefinition.findMany).not.toHaveBeenCalled();
  });

  it("sets a Groups audience with validated group ids", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([
      { id: "g1", archivedAt: null, boundTermIds: [] },
      { id: "g2", archivedAt: null, boundTermIds: [] },
    ]);

    const res = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Groups",
        groupIds: '["g1","g2"]',
      }),
      "user-1",
    );

    expect(res).toEqual({ ok: true });
    expect(mockPrisma.form.update).toHaveBeenCalledWith({
      where: { id: "form-1" },
      data: { audience: "Groups", audienceGroupIds: ["g1", "g2"] },
    });
  });

  it("rejects Groups with no groups selected", async () => {
    const res = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Groups",
        groupIds: "[]",
      }),
      "user-1",
    );
    expect(res).toEqual({ error: "Select at least one group.", status: 400 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("rejects missing and archived groups", async () => {
    mockPrisma.groupDefinition.findMany.mockResolvedValue([
      { id: "g1", archivedAt: new Date("2026-01-01"), boundTermIds: [] },
    ]);
    const archived = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Groups",
        groupIds: '["g1"]',
      }),
      "user-1",
    );
    expect(archived).toMatchObject({ status: 400 });

    mockPrisma.groupDefinition.findMany.mockResolvedValue([]);
    const missing = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Groups",
        groupIds: '["ghost"]',
      }),
      "user-1",
    );
    expect(missing).toMatchObject({ status: 400 });
    expect(mockPrisma.form.update).not.toHaveBeenCalled();
  });

  it("rejects malformed groupIds JSON and bad audience values", async () => {
    const malformed = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Groups",
        groupIds: "[oops",
      }),
      "user-1",
    );
    expect(malformed).toEqual({ error: "Invalid input", status: 400 });

    const badEnum = await runFormsAction(
      fd({
        intent: "update-form-audience",
        id: "form-1",
        audience: "Everyone",
      }),
      "user-1",
    );
    expect(badEnum).toEqual({ error: "Invalid input", status: 400 });
  });

  it("404s an unknown form", async () => {
    mockPrisma.form.findUnique.mockResolvedValue(null);
    const res = await runFormsAction(
      fd({ intent: "update-form-audience", id: "ghost", audience: "Public" }),
      "user-1",
    );
    expect(res).toEqual({ error: "Not found", status: 404 });
  });
});
