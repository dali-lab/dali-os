import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("~/lib/resource-hub.server", () => ({ ledDomainIds: vi.fn(), requireResourceHubViewer: vi.fn() }));
vi.mock("~/lib/link-preview.server", () => ({ fetchLinkPreview: vi.fn() }));

import { parseCommentForm, parseSubmissionForm, serializeComments, serializeSubmission, UPLOAD_URL_PREFIX } from "../crit.server";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  Object.entries(o).forEach(([k, v]) => f.set(k, v));
  return f;
};
const person = { firstName: "Ada", lastName: "Lovelace" };
const row = (o: Partial<Parameters<typeof serializeSubmission>[0]> = {}) => ({
  id: "s1", title: "Logo", question: null, kind: "image", url: `${UPLOAD_URL_PREFIX}a.png`, previewUrl: null, fileName: "a.png",
  anonymous: false, authorId: "u1", author: person, createdAt: new Date("2026-11-14T00:00:00Z"), _count: { comments: 3 }, ...o,
});

describe("serializeSubmission", () => {
  it("names the author on a normal post", () => {
    const s = serializeSubmission(row(), "u2", false);
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

describe("serializeComments", () => {
  const c = (id: string, t: number, o: object = {}) => ({ id, parentId: null, body: id, x: null, y: null, authorId: "u1", author: person, createdAt: new Date(t), ...o });
  it("numbers pins in the order they were placed, skipping general comments and replies", () => {
    const out = serializeComments([c("b", 2, { x: 0.5, y: 0.5 }), c("a", 1, { x: 0.1, y: 0.2 }), c("g", 3), c("r", 4, { parentId: "a", x: 0.9, y: 0.9 })], "u9", false);
    expect(out.map((x) => [x.id, x.pin])).toEqual([["a", 1], ["b", 2], ["g", null], ["r", null]]);
    expect(out.find((x) => x.id === "r")).toMatchObject({ x: null, y: null });
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

describe("parseCommentForm", () => {
  it("needs text", () => expect(parseCommentForm(form({ body: "  " })).ok).toBe(false));
  it("keeps a pin position as fractions of the image", () => {
    expect(parseCommentForm(form({ body: "nice", x: "0.25", y: "0.75" }))).toMatchObject({ ok: true, value: { x: 0.25, y: 0.75 } });
  });
  it("rejects out-of-range or half-given positions", () => {
    expect(parseCommentForm(form({ body: "a", x: "1.2", y: "0.5" })).ok).toBe(false);
    expect(parseCommentForm(form({ body: "a", x: "0.5" })).ok).toBe(false);
  });
  it("drops the position on a reply", () => {
    expect(parseCommentForm(form({ body: "a", x: "0.5", y: "0.5", parentId: "p" }))).toMatchObject({ ok: true, value: { x: null, y: null, parentId: "p" } });
  });
});
