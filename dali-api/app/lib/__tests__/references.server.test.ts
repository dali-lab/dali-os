import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { fetchLinkPreview } from "~/lib/link-preview.server";
import { UPLOAD_URL_PREFIX } from "../crit.server";
import { parseReferenceEdit, parseReferenceForm, resolveReference, serializeReference, type ReferenceInput } from "../references.server";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const row = (o: Partial<Parameters<typeof serializeReference>[0]> = {}) => ({
  id: "r1", title: "Hero", kind: "link", url: "https://a.example", previewUrl: null, fileName: null, creatorName: "Studio X", daliMade: false, note: null,
  authorId: "u1", author: { firstName: "Ada", lastName: "Lovelace" }, createdAt: new Date("2026-11-14T00:00:00Z"), ...o,
});

describe("serializeReference", () => {
  it("credits someone else's work to the named creator and shows who shared it", () => {
    expect(serializeReference(row(), "u2", false)).toMatchObject({ creatorName: "Studio X", sharedBy: "Ada Lovelace", daliMade: false });
  });
  it("credits DALI-made work to the member who posted it, whatever creator name was stored", () => {
    expect(serializeReference(row({ daliMade: true, creatorName: "Ignored" }), "u2", false)).toMatchObject({ creatorName: "Ada Lovelace", daliMade: true });
  });
  it("lets the owner edit and delete, a moderator delete only, and others neither", () => {
    expect(serializeReference(row(), "u1", false)).toMatchObject({ mine: true, canDelete: true });
    expect(serializeReference(row(), "u2", true)).toMatchObject({ mine: false, canDelete: true });
    expect(serializeReference(row(), "u2", false)).toMatchObject({ mine: false, canDelete: false });
  });
  it("does not expose the author id", () => {
    expect(JSON.stringify(serializeReference(row(), "u2", false))).not.toMatch(/authorId/);
  });
});

describe("parseReferenceForm", () => {
  it("accepts an upload through the app's own upload URL only", () => {
    expect(parseReferenceForm(form({ kind: "image", url: `${UPLOAD_URL_PREFIX}x.png`, fileName: "x.png" })).ok).toBe(true);
    expect(parseReferenceForm(form({ kind: "file", url: `${UPLOAD_URL_PREFIX}x.pdf` })).ok).toBe(true);
    expect(parseReferenceForm(form({ kind: "image", url: "https://evil.example/x.png" })).ok).toBe(false);
    expect(parseReferenceForm(form({ kind: "file", url: "/api/upload/raw?key=other%2Fx" })).ok).toBe(false);
  });
  it("accepts web links and rejects anything else", () => {
    expect(parseReferenceForm(form({ kind: "link", url: "https://www.figma.com/file/1" })).ok).toBe(true);
    expect(parseReferenceForm(form({ kind: "link", url: "figma.com/file/1" })).ok).toBe(true);
    for (const url of ["javascript:alert(1)", "mailto:a@b.co", "/relative", ""]) {
      expect(parseReferenceForm(form({ kind: "link", url })).ok, url).toBe(false);
    }
    expect(parseReferenceForm(form({ kind: "video", url: "https://a.example" })).ok).toBe(false);
  });
  it("marks my work as DALI-made and drops any creator name", () => {
    const r = parseReferenceForm(form({ kind: "link", url: "https://a.example", creator: "mine", creatorName: "Someone" }));
    expect(r).toMatchObject({ ok: true, value: { daliMade: true, creatorName: null } });
  });
  it("keeps an optional creator for someone else's work, and never badges it", () => {
    expect(parseReferenceForm(form({ kind: "link", url: "https://a.example", creator: "other", creatorName: "  Studio   X " }))).toMatchObject({ ok: true, value: { daliMade: false, creatorName: "Studio X" } });
    expect(parseReferenceForm(form({ kind: "link", url: "https://a.example", creator: "other" }))).toMatchObject({ ok: true, value: { daliMade: false, creatorName: null } });
  });
  it("treats a missing or unknown creator as someone else's work", () => {
    for (const creator of [undefined, "", "yes", "true"]) {
      const r = parseReferenceForm(form({ kind: "link", url: "https://a.example", ...(creator === undefined ? {} : { creator }) }));
      expect(r, String(creator)).toMatchObject({ ok: true, value: { daliMade: false } });
    }
  });
  it("trims and caps the title and note", () => {
    const r = parseReferenceForm(form({ kind: "link", url: "https://a.example", title: ` ${"t".repeat(300)} `, note: `  why   so  ${"n".repeat(500)}` }));
    expect(r.ok && r.value.title.length).toBe(120);
    expect(r.ok && r.value.note?.length).toBe(400);
    expect(r.ok && r.value.note?.startsWith("why so n")).toBe(true);
  });
  it("stores no note when it is blank", () => {
    expect(parseReferenceForm(form({ kind: "link", url: "https://a.example", note: "   " }))).toMatchObject({ ok: true, value: { note: null } });
  });
});

describe("parseReferenceEdit", () => {
  it("needs a title", () => expect(parseReferenceEdit(form({ title: "  " })).ok).toBe(false));
  it("carries title, note and credit", () => {
    expect(parseReferenceEdit(form({ title: "New", note: "n", creator: "other", creatorName: "Z" }))).toMatchObject({ ok: true, value: { title: "New", note: "n", daliMade: false, creatorName: "Z" } });
    expect(parseReferenceEdit(form({ title: "New", creator: "mine", creatorName: "Z" }))).toMatchObject({ ok: true, value: { daliMade: true, creatorName: null } });
  });
});

describe("resolveReference", () => {
  const input = (o: Partial<ReferenceInput> = {}): ReferenceInput => ({ kind: "link", url: "https://www.site.example/p", fileName: null, title: "", note: null, daliMade: false, creatorName: null, ...o });
  beforeEach(() => vi.mocked(fetchLinkPreview).mockReset());

  it("keeps the title the member typed and takes the page's image", async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue({ title: "Page", image: "https://img.example/a.png", description: null });
    expect(await resolveReference(input({ title: "Mine" }))).toEqual({ title: "Mine", previewUrl: "https://img.example/a.png" });
  });
  it("falls back to the page title, then the host", async () => {
    vi.mocked(fetchLinkPreview).mockResolvedValue({ title: "Page", image: null, description: null });
    expect((await resolveReference(input())).title).toBe("Page");
    vi.mocked(fetchLinkPreview).mockResolvedValue(null);
    expect(await resolveReference(input())).toEqual({ title: "site.example", previewUrl: null });
  });
  it("uses a pasted image address as its own preview without fetching a page", async () => {
    expect(await resolveReference(input({ url: "https://cdn.example/shot.png?w=800" }))).toEqual({ title: "cdn.example", previewUrl: "https://cdn.example/shot.png?w=800" });
    expect(fetchLinkPreview).not.toHaveBeenCalled();
  });
  it("titles an upload by its file name", async () => {
    expect(await resolveReference(input({ kind: "image", url: `${UPLOAD_URL_PREFIX}a.png`, fileName: "Moodboard v2.png" }))).toEqual({ title: "Moodboard v2", previewUrl: null });
    expect((await resolveReference(input({ kind: "file", url: `${UPLOAD_URL_PREFIX}a`, fileName: null }))).title).toBe("Untitled reference");
  });
});
