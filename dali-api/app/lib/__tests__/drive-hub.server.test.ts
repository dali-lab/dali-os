import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    term: { findUnique: vi.fn() },
    educationOffering: { findMany: vi.fn() },
    docTag: { findMany: vi.fn() },
    pageTag: { findMany: vi.fn() },
    projectFileTag: { findMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db";
import {
  loadProjectWorkspaces,
  loadEducationWorkspaces,
  loadAllDocTags,
  loadItemTagIds,
} from "~/lib/drive-hub.server";

const m = prisma as any;
const WINDOW = { startDate: new Date("2026-09-01"), endDate: new Date("2026-12-01") };
const startsInWindow = { startsAt: { gte: WINDOW.startDate, lte: WINDOW.endDate } };

beforeEach(() => {
  vi.resetAllMocks();
  m.project.findMany.mockResolvedValue([]);
  m.term.findUnique.mockResolvedValue(WINDOW);
  m.educationOffering.findMany.mockResolvedValue([]);
  m.pageTag.findMany.mockResolvedValue([]);
  m.projectFileTag.findMany.mockResolvedValue([]);
});

describe("loadProjectWorkspaces", () => {
  it("shapes projects as workspaces, keeping the query's order", async () => {
    m.project.findMany.mockResolvedValue([
      { id: "p1", name: "Alpha", iconEmoji: "A" },
      { id: "p2", name: "Beta", iconEmoji: null },
    ]);
    expect(await loadProjectWorkspaces({ userId: "u", isCore: true, termId: null })).toEqual([
      { key: "p1", label: "Alpha", kind: "project", projectIconEmoji: "A" },
      { key: "p2", label: "Beta", kind: "project", projectIconEmoji: null },
    ]);
  });

  it("gives Core every project and drops the term gate for All terms", async () => {
    await loadProjectWorkspaces({ userId: "u", isCore: true, termId: null });
    expect(m.project.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("gives a non-Core lab member every project too, not only the ones they are staffed on", async () => {
    await loadProjectWorkspaces({ userId: "u", isCore: false, termId: null });
    expect(m.project.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("scopes to the selected term", async () => {
    await loadProjectWorkspaces({ userId: "u", isCore: true, termId: "t1" });
    expect(m.project.findMany.mock.calls[0][0].where).toEqual({ projectTerms: { some: { termId: "t1" } } });
  });
});

describe("loadEducationWorkspaces", () => {
  it("lists every offering for Core under All terms, without reading a term", async () => {
    m.educationOffering.findMany.mockResolvedValue([{ id: "o1", title: "Intro" }]);
    const out = await loadEducationWorkspaces({ userId: "u", isCore: true, termId: null });
    expect(out).toEqual([{ key: "o1", label: "Intro", kind: "education" }]);
    expect(m.term.findUnique).not.toHaveBeenCalled();
    expect(m.educationOffering.findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it("limits Core to offerings starting inside the selected term", async () => {
    await loadEducationWorkspaces({ userId: "u", isCore: true, termId: "t1" });
    expect(m.term.findUnique).toHaveBeenCalledWith({ where: { id: "t1" }, select: { startDate: true, endDate: true } });
    expect(m.educationOffering.findMany.mock.calls[0][0].where).toEqual(startsInWindow);
  });

  it("does not gate on a term that no longer exists", async () => {
    m.term.findUnique.mockResolvedValue(null);
    await loadEducationWorkspaces({ userId: "u", isCore: true, termId: "gone" });
    expect(m.educationOffering.findMany.mock.calls[0][0].where).toBeUndefined();
  });

  it("gives a non-Core viewer offerings they instruct or were approved for, inside the term", async () => {
    await loadEducationWorkspaces({ userId: "u", isCore: false, termId: "t1" });
    expect(m.educationOffering.findMany.mock.calls[0][0].where).toEqual({
      AND: [
        startsInWindow,
        {
          OR: [
            { instructors: { some: { userId: "u" } } },
            { applications: { some: { applicantUserId: "u", status: "Approved" } } },
          ],
        },
      ],
    });
  });

  it("orders offerings by title", async () => {
    await loadEducationWorkspaces({ userId: "u", isCore: true, termId: null });
    expect(m.educationOffering.findMany.mock.calls[0][0].orderBy).toEqual({ title: "asc" });
  });
});

describe("loadAllDocTags", () => {
  it("lists live tags by label, whether or not anything is tagged", async () => {
    m.docTag.findMany.mockResolvedValue([]);
    await loadAllDocTags();
    expect(m.docTag.findMany).toHaveBeenCalledWith({
      where: { archivedAt: null },
      orderBy: { label: "asc" },
      select: { id: true, label: true, slug: true, color: true },
    });
  });
});

describe("loadItemTagIds", () => {
  const scope = (...items: Array<[string, string]>) => ({ items: items.map(([type, id]) => ({ type, id })) as never });

  it("reads page tags for docs and folders and file tags for files, across every scope", async () => {
    m.pageTag.findMany.mockResolvedValue([
      { pageId: "d1", tag: { id: "t1" } },
      { pageId: "d1", tag: { id: "t2" } },
      { pageId: "fo1", tag: { id: "t1" } },
    ]);
    m.projectFileTag.findMany.mockResolvedValue([{ fileId: "f1", tag: { id: "t3" } }]);

    const out = await loadItemTagIds([
      scope(["doc", "d1"], ["file", "f1"], ["form", "fm1"]),
      scope(["folder", "fo1"], ["agreement", "a1"]),
    ]);

    expect(m.pageTag.findMany.mock.calls[0][0].where.pageId).toEqual({ in: ["d1", "fo1"] });
    expect(m.projectFileTag.findMany.mock.calls[0][0].where.fileId).toEqual({ in: ["f1"] });
    expect(out).toEqual({ d1: ["t1", "t2"], fo1: ["t1"], f1: ["t3"] });
  });

  it("runs no query for a kind the scopes don't hold", async () => {
    expect(await loadItemTagIds([scope(["form", "fm1"])])).toEqual({});
    expect(m.pageTag.findMany).not.toHaveBeenCalled();
    expect(m.projectFileTag.findMany).not.toHaveBeenCalled();
  });

  it("only queries pages when there are no files", async () => {
    await loadItemTagIds([scope(["doc", "d1"])]);
    expect(m.pageTag.findMany).toHaveBeenCalledTimes(1);
    expect(m.projectFileTag.findMany).not.toHaveBeenCalled();
  });
});
