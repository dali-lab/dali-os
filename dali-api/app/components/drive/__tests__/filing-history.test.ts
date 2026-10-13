import { afterEach, describe, expect, it, vi } from "vitest";
import { filingEntry, shortcutEntry } from "~/components/drive/filing-history";
import type { PagePlace } from "~/components/drive/file-in";

const previous: PagePlace = { workspaceType: "Lab", workspaceId: null, folderId: "ops", path: [{ id: "ops", title: "Ops" }] };
const destinations = [
  { workspaceType: "Lab", workspaceId: null, parentPageId: "design" },
  { workspaceType: "Lab", workspaceId: null, parentPageId: "checkins" },
] as const;

const reply = (body: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status });

function stub(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null });
      return handler(url, init);
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const base = {
  pageId: "p1",
  previousPrimary: previous,
  primaryChanged: true,
  destinations: [...destinations],
  primaryIndex: 0,
  createdShortcutIds: ["s1", "s2"],
};

describe("filingEntry", () => {
  it("is a Filing, so its toasts read Filing undone and Filing redone", () => {
    expect(filingEntry(base).label).toBe("Filing");
  });

  it("undo moves the page back to its previous primary, then deletes the shortcuts it created", async () => {
    const calls = stub(() => reply());
    await filingEntry(base).undo();
    expect(calls).toEqual([
      { url: "/api/pages/p1/move", method: "POST", body: { parentPageId: "ops", workspaceType: "Lab", workspaceId: null } },
      { url: "/api/shortcuts/s1", method: "DELETE", body: null },
      { url: "/api/shortcuts/s2", method: "DELETE", body: null },
    ]);
  });

  it("undo leaves the page where it is when only shortcuts were added", async () => {
    const calls = stub(() => reply());
    await filingEntry({ ...base, primaryChanged: false }).undo();
    expect(calls.map((c) => c.url)).toEqual(["/api/shortcuts/s1", "/api/shortcuts/s2"]);
  });

  it("undo puts a project page back in its project", async () => {
    const calls = stub(() => reply());
    const place: PagePlace = { workspaceType: "Project", workspaceId: "proj", folderId: null, path: [] };
    await filingEntry({ ...base, previousPrimary: place, createdShortcutIds: [] }).undo();
    expect(calls[0].body).toEqual({ parentPageId: null, workspaceType: "Project", workspaceId: "proj" });
  });

  it("undo stops and says why when the page can't be moved back, leaving the shortcuts alone", async () => {
    const calls = stub(() => reply({ error: "You can't put things in that folder" }, 403));
    await expect(filingEntry(base).undo()).rejects.toThrow("You can't put things in that folder");
    expect(calls).toHaveLength(1);
  });

  it("undo refuses to send a page back into My Drive", async () => {
    const calls = stub(() => reply());
    const member: PagePlace = { workspaceType: "Member", workspaceId: "u", folderId: null, path: [] };
    await expect(filingEntry({ ...base, previousPrimary: member }).undo()).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("undo throws when a shortcut can't be removed", async () => {
    stub((url) => (url.includes("s2") ? reply({}, 500) : reply()));
    await expect(filingEntry(base).undo()).rejects.toThrow("Couldn't remove the shortcuts");
  });

  it("undo treats a shortcut that is already gone as removed", async () => {
    stub((url) => (url.includes("/api/shortcuts/") ? reply({}, 404) : reply()));
    await expect(filingEntry(base).undo()).resolves.toBeUndefined();
  });

  it("redo files the page again with the same destinations and primary", async () => {
    const calls = stub(() => reply({ ok: true, declined: 0, shortcutIds: ["n1", "n2"] }));
    await filingEntry({ ...base, primaryIndex: 1 }).redo();
    expect(calls).toEqual([
      { url: "/api/pages/p1/place", method: "POST", body: { destinations: [...destinations], primaryIndex: 1 } },
    ]);
  });

  it("a later undo removes the shortcuts redo created, not the first ones", async () => {
    const calls = stub((url) => (url.endsWith("/place") ? reply({ ok: true, declined: 0, shortcutIds: ["n1"] }) : reply()));
    const entry = filingEntry(base);
    await entry.undo();
    await entry.redo();
    calls.length = 0;
    await entry.undo();
    expect(calls.map((c) => c.url)).toEqual(["/api/pages/p1/move", "/api/shortcuts/n1"]);
  });

  it("redo throws the server's reason when it is refused", async () => {
    stub(() => reply({ error: "No access" }, 403));
    await expect(filingEntry(base).redo()).rejects.toThrow("No access");
  });
});

describe("shortcutEntry", () => {
  const dest = { workspaceType: "Lab", workspaceId: null, parentPageId: "design" } as const;

  it("undo removes the shortcut", async () => {
    const calls = stub(() => reply());
    await shortcutEntry({ pageId: "p1", dest, shortcutId: "s9" }).undo();
    expect(calls).toEqual([{ url: "/api/shortcuts/s9", method: "DELETE", body: null }]);
  });

  it("redo adds it again and the next undo removes the new one", async () => {
    const calls = stub((url) => (url === "/api/shortcuts" ? reply({ ok: true, shortcutId: "s10", created: true, grantDeclined: false }) : reply()));
    const entry = shortcutEntry({ pageId: "p1", dest, shortcutId: "s9" });
    await entry.undo();
    await entry.redo();
    await entry.undo();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "DELETE /api/shortcuts/s9",
      "POST /api/shortcuts",
      "DELETE /api/shortcuts/s10",
    ]);
    expect(calls[1].body).toEqual({ targetPageId: "p1", dest });
  });

  it("has its own undone and redone messages", () => {
    const entry = shortcutEntry({ pageId: "p1", dest, shortcutId: "s9" });
    expect(entry.undoneMessage).toBe("Shortcut removed");
    expect(entry.redoneMessage).toBe("Shortcut added again");
  });

  it("redo throws when the shortcut can't be added", async () => {
    stub(() => reply({ error: "Nope" }, 403));
    await expect(shortcutEntry({ pageId: "p1", dest, shortcutId: "s9" }).redo()).rejects.toThrow("Nope");
  });
});
