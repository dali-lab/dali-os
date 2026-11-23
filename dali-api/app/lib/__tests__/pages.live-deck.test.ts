import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => {
  const prisma: any = { page: { findFirst: vi.fn(), create: vi.fn() }, $executeRaw: vi.fn() };
  prisma.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock("~/drive/lib/page-names.server", () => ({ assertUniqueName: vi.fn() }));
vi.mock("~/lib/live-deck.server", () => ({ ensureLiveDeck: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { ensureLiveDeck } from "~/lib/live-deck.server";
import { createLabMeetingPage, createLabPage, createProjectPage } from "~/lib/pages.server";

const m = prisma as any;

beforeEach(() => {
  vi.resetAllMocks();
  m.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(m));
  m.page.findFirst.mockResolvedValue(null);
  m.page.create.mockResolvedValue({ id: "new" });
});

describe("a new Slides page is a live deck", () => {
  it("in the lab", async () => {
    await createLabPage({ title: "Deck", createdById: "u1", kind: "Slides" });
    expect(ensureLiveDeck).toHaveBeenCalledWith("new", "u1");
  });

  it("in a project", async () => {
    await createProjectPage({ projectId: "p1", title: "Deck", createdById: "u1", kind: "Slides" });
    expect(ensureLiveDeck).toHaveBeenCalledWith("new", "u1");
  });

  it("when filed as a lab meeting page", async () => {
    await createLabMeetingPage({ title: "Deck", createdById: "u1", kind: "Slides" });
    expect(ensureLiveDeck).toHaveBeenCalledWith("new", "u1");
  });

  it("only after the page row exists", async () => {
    m.page.create.mockRejectedValue(new Error("taken"));
    await expect(createLabPage({ title: "Deck", createdById: "u1", kind: "Slides" })).rejects.toThrow("taken");
    expect(ensureLiveDeck).not.toHaveBeenCalled();
  });

  it.each(["FreeForm", "Folder", "Whiteboard", undefined] as const)("not for kind %s", async (kind) => {
    await createLabPage({ title: "Doc", createdById: "u1", kind });
    await createProjectPage({ projectId: "p1", title: "Doc", createdById: "u1", kind });
    expect(ensureLiveDeck).not.toHaveBeenCalled();
  });
});
