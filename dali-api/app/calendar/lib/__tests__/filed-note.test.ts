import { describe, it, expect, vi } from "vitest";
import { filedNoteFrom, filedWhere, filedWhereLabel, undoFiledNote } from "../filed-note";

const ok = { ok: true };
const fail = { ok: false };

describe("undoFiledNote", () => {
  it("trashes the note and leaves a notebook it did not create", async () => {
    const doFetch = vi.fn().mockResolvedValue(ok);
    const res = await undoFiledNote({ notePageId: "n1", notebookId: "nb1", createdNotebook: false }, doFetch);
    expect(res).toEqual({ ok: true, notebookTrashed: false });
    expect(doFetch).toHaveBeenCalledTimes(1);
    expect(doFetch).toHaveBeenCalledWith("/api/documents/n1", { method: "DELETE", credentials: "include" });
  });

  it("also trashes a notebook created by the same action, only while it is empty", async () => {
    const doFetch = vi.fn().mockResolvedValue(ok);
    const res = await undoFiledNote({ notePageId: "n1", notebookId: "nb1", createdNotebook: true }, doFetch);
    expect(res).toEqual({ ok: true, notebookTrashed: true });
    expect(doFetch.mock.calls.map((c) => c[0])).toEqual(["/api/documents/n1", "/api/documents/nb1?ifEmpty=1"]);
  });

  it("trashes the note before the notebook", async () => {
    const order: string[] = [];
    const doFetch = vi.fn(async (url: string) => {
      order.push(url);
      return ok;
    });
    await undoFiledNote({ notePageId: "n1", notebookId: "nb1", createdNotebook: true }, doFetch);
    expect(order[0]).toBe("/api/documents/n1");
  });

  it("keeps a notebook that still holds other notes, and still counts the undo as done", async () => {
    const doFetch = vi.fn().mockResolvedValueOnce(ok).mockResolvedValueOnce(fail);
    const res = await undoFiledNote({ notePageId: "n1", notebookId: "nb1", createdNotebook: true }, doFetch);
    expect(res).toEqual({ ok: true, notebookTrashed: false });
  });

  it("leaves the notebook alone when the note could not be trashed", async () => {
    const doFetch = vi.fn().mockResolvedValue(fail);
    const res = await undoFiledNote({ notePageId: "n1", notebookId: "nb1", createdNotebook: true }, doFetch);
    expect(res).toEqual({ ok: false, notebookTrashed: false });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("does not try a notebook it was never told about", async () => {
    const doFetch = vi.fn().mockResolvedValue(ok);
    await undoFiledNote({ notePageId: "n1", notebookId: null, createdNotebook: true }, doFetch);
    expect(doFetch).toHaveBeenCalledTimes(1);
  });
});

describe("filedNoteFrom", () => {
  const notePath = { label: "General ▸ Notes", href: "/documents/n1" };

  it("reads the filing details out of a create response", () => {
    expect(
      filedNoteFrom({ notePageId: "n1", notebookId: "nb1", createdNotebook: true, notePath }),
    ).toEqual({ notePageId: "n1", notebookId: "nb1", createdNotebook: true, notePath });
  });

  it("treats a missing createdNotebook as false", () => {
    expect(filedNoteFrom({ notePageId: "n1", notebookId: "nb1", notePath })?.createdNotebook).toBe(false);
  });

  it("is null without a note or without a path", () => {
    expect(filedNoteFrom({ notePageId: null, notePath })).toBeNull();
    expect(filedNoteFrom({ notePageId: "n1", notePath: null })).toBeNull();
    expect(filedNoteFrom({})).toBeNull();
  });
});

describe("filedWhere", () => {
  const at = (label: string) => ({ notePath: { label, href: "/documents/n1" } });

  it("names the notebook and the project it is in", () => {
    expect(filedWhere(at("Projects ▸ Atlas ▸ Meetings ▸ Weekly sync"))).toEqual({ title: "Weekly sync", space: "Atlas" });
  });

  it("names a process space", () => {
    expect(filedWhere(at("Core ▸ Meetings ▸ Weekly sync"))).toEqual({ title: "Weekly sync", space: "Core" });
    expect(filedWhere(at("General ▸ Weekly sync"))).toEqual({ title: "Weekly sync", space: "General" });
  });

  it("has no space for a bare title", () => {
    expect(filedWhere(at("Weekly sync"))).toEqual({ title: "Weekly sync", space: "" });
    expect(filedWhereLabel(at("Weekly sync"))).toBe("Weekly sync");
  });

  it("joins title and space for the toast", () => {
    expect(filedWhereLabel(at("Projects ▸ Atlas ▸ Weekly sync"))).toBe("Weekly sync · Atlas");
  });
});
