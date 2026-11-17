import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { parseSubmissionForm, serializeSubmission, UPLOAD_URL_PREFIX } from "../crit.server";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const person = { firstName: "Ada", lastName: "Lovelace" };
const row = (o: Partial<Parameters<typeof serializeSubmission>[0]> = {}) => ({
  id: "s1", title: "Logo", question: null, kind: "image", url: `${UPLOAD_URL_PREFIX}a.png`, previewUrl: null, fileName: "a.png",
  anonymous: false, authorId: "u1", author: person, createdAt: new Date("2026-11-14T00:00:00Z"), ...o,
});

describe("serializeSubmission", () => {
  it("names the author on a normal post", () => {
    const s = serializeSubmission(row(), "u2", false, 3);
    expect(s.authorName).toBe("Ada Lovelace");
    expect(s.mine).toBe(false);
    expect(s.commentCount).toBe(3);
  });
  it("never exposes who posted an anonymous submission", () => {
    const s = serializeSubmission(row({ anonymous: true }), "u2", false);
    expect(s.authorName).toBeNull();
    expect(JSON.stringify(s)).not.toMatch(/Ada|Lovelace|u1|authorId/);
  });
  it("tells the author their own anonymous post, and lets owners and moderators delete", () => {
    expect(serializeSubmission(row({ anonymous: true }), "u1", false)).toMatchObject({ mine: true, canDelete: true, authorName: null });
    expect(serializeSubmission(row(), "u2", false).canDelete).toBe(false);
    expect(serializeSubmission(row(), "u2", true).canDelete).toBe(true);
  });
});

describe("serializeSubmission moderation", () => {
  it("tells the client whether the viewer moderates, apart from owning the post", () => {
    expect(serializeSubmission(row(), "u2", true)).toMatchObject({ canModerate: true, canDelete: true });
    expect(serializeSubmission(row(), "u1", false)).toMatchObject({ canModerate: false, canDelete: true });
  });
});

describe("parseSubmissionForm", () => {
  it("accepts an upload through the app's own upload URL only", () => {
    expect(parseSubmissionForm(form({ kind: "image", url: `${UPLOAD_URL_PREFIX}x.png`, fileName: "x.png" })).ok).toBe(true);
    expect(parseSubmissionForm(form({ kind: "image", url: "https://evil.example/x.png" })).ok).toBe(false);
    expect(parseSubmissionForm(form({ kind: "file", url: "/api/upload/raw?key=other%2Fx" })).ok).toBe(false);
  });
  it("accepts web links and rejects anything else", () => {
    expect(parseSubmissionForm(form({ kind: "link", url: "https://www.figma.com/file/1" })).ok).toBe(true);
    expect(parseSubmissionForm(form({ kind: "link", url: "figma.com/file/1" })).ok).toBe(true);
    for (const url of ["javascript:alert(1)", "mailto:a@b.co", "/relative", ""]) {
      expect(parseSubmissionForm(form({ kind: "link", url })).ok, url).toBe(false);
    }
  });
  it("reads the anonymous flag and trims the question", () => {
    const r = parseSubmissionForm(form({ kind: "link", url: "https://a.example", anonymous: "1", question: "  What   do you think? " }));
    expect(r).toMatchObject({ ok: true, value: { anonymous: true, question: "What do you think?" } });
  });
});
