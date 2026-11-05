import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server");

import { setPlanningNote, toPlanningNoteView } from "../planning-notes.server";

function fakeDb() {
  const db = {
    project: { findUnique: vi.fn().mockResolvedValue({ id: "p1" }) },
    partnerApplication: { findUnique: vi.fn().mockResolvedValue({ id: "a1" }) },
    planningNote: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  return { db: db as never, raw: db };
}

beforeEach(() => vi.clearAllMocks());

describe("setPlanningNote", () => {
  it("upserts a trimmed project note and records who edited it", async () => {
    const { db, raw } = fakeDb();
    expect(await setPlanningNote(db, { owner: { projectId: "p1" }, body: "  Waiting on budget  ", userId: "u1" })).toBe(
      "ok",
    );
    expect(raw.planningNote.upsert).toHaveBeenCalledWith({
      where: { projectId: "p1" },
      create: { projectId: "p1", body: "Waiting on budget", updatedById: "u1" },
      update: { body: "Waiting on budget", updatedById: "u1" },
    });
  });

  it("keys an application note by application id", async () => {
    const { db, raw } = fakeDb();
    await setPlanningNote(db, { owner: { applicationId: "a1" }, body: "Call Tuesday", userId: "u2" });
    expect(raw.partnerApplication.findUnique).toHaveBeenCalledWith({ where: { id: "a1" }, select: { id: true } });
    expect(raw.project.findUnique).not.toHaveBeenCalled();
    expect(raw.planningNote.upsert.mock.calls[0][0].where).toEqual({ applicationId: "a1" });
  });

  it("deletes the note when it is saved blank", async () => {
    const { db, raw } = fakeDb();
    await setPlanningNote(db, { owner: { projectId: "p1" }, body: "   ", userId: "u1" });
    expect(raw.planningNote.deleteMany).toHaveBeenCalledWith({ where: { projectId: "p1" } });
    expect(raw.planningNote.upsert).not.toHaveBeenCalled();
  });

  it("reports a project or application that does not exist, without writing", async () => {
    const { db, raw } = fakeDb();
    raw.project.findUnique.mockResolvedValue(null);
    raw.partnerApplication.findUnique.mockResolvedValue(null);
    expect(await setPlanningNote(db, { owner: { projectId: "gone" }, body: "x", userId: "u1" })).toBe("not-found");
    expect(await setPlanningNote(db, { owner: { applicationId: "gone" }, body: "", userId: "u1" })).toBe("not-found");
    expect(raw.planningNote.upsert).not.toHaveBeenCalled();
    expect(raw.planningNote.deleteMany).not.toHaveBeenCalled();
  });
});

describe("toPlanningNoteView", () => {
  it("returns null without a note", () => {
    expect(toPlanningNoteView(null)).toBeNull();
  });

  it("names the last editor and serializes the time", () => {
    expect(
      toPlanningNoteView({
        body: "Hi",
        updatedAt: new Date("2026-11-05T15:00:00Z"),
        updatedBy: { firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@x" },
      }),
    ).toEqual({ body: "Hi", updatedAt: "2026-11-05T15:00:00.000Z", updatedByName: "Ada Lovelace" });
  });

  it("leaves the editor empty when that user is gone", () => {
    expect(toPlanningNoteView({ body: "Hi", updatedAt: new Date(0), updatedBy: null })?.updatedByName).toBeNull();
  });
});
