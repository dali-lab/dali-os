import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn(async (v: string | null) => (v && !v.startsWith("pattern:") ? `signed:${v}` : null)) }));

import { prisma } from "~/lib/db.server";
import { loadPublicProjectView } from "../public-project-view.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const load = async (imageUrl: string | null, showcase: Record<string, unknown> | null) => {
  db.project.findUnique.mockResolvedValue({ id: "p1", name: "Atlas", iconEmoji: null, imageUrl, showcase });
  return (await loadPublicProjectView("p1"))!;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.projectAssignment.findMany.mockResolvedValue([]);
});

describe("public project view cover", () => {
  it("passes the project's pattern cover as the hero fallback", async () => {
    const view = await load("pattern:poster?c=plum", null);
    expect(view.heroPattern).toBe("pattern:poster?c=plum");
    expect(view.heroPreviewUrl).toBeNull();
  });

  it("lets the showcase hero image win over a pattern cover", async () => {
    const view = await load("pattern:poster", { heroImageUrl: "uploads/hero.webp", media: [], details: [], updatedAt: new Date() });
    expect(view.heroPattern).toBeNull();
    expect(view.heroPreviewUrl).toBe("signed:uploads/hero.webp");
  });

  it("has no pattern for an uploaded or missing project image", async () => {
    expect((await load("uploads/a.webp", null)).heroPattern).toBeNull();
    expect((await load(null, null)).heroPattern).toBeNull();
  });
});
