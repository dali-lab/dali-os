import { describe, expect, it } from "vitest";
import {
  canViewReleaseNote,
  hasUnseenReleaseNotes,
  isReleaseNoteVideoKey,
  parsePrNumbers,
  releaseNoteAreaLabel,
} from "../release-notes";

const member = { isCore: false, groupIds: ["g1", "g2"] };
const core = { isCore: true, groupIds: [] };
const outsider = { isCore: false, groupIds: ["g9"] };

describe("canViewReleaseNote", () => {
  it("shows an all-members note to anyone", () => {
    const note = { allMembers: true, groupIds: [] };
    expect(canViewReleaseNote(note, member)).toBe(true);
    expect(canViewReleaseNote(note, outsider)).toBe(true);
  });

  it("shows an all-members note regardless of listed groups", () => {
    expect(canViewReleaseNote({ allMembers: true, groupIds: ["g1"] }, outsider)).toBe(true);
  });

  it("shows a group note to a member of any listed group", () => {
    const note = { allMembers: false, groupIds: ["g5", "g2"] };
    expect(canViewReleaseNote(note, member)).toBe(true);
  });

  it("hides a group note from a non-member", () => {
    const note = { allMembers: false, groupIds: ["g1", "g2"] };
    expect(canViewReleaseNote(note, outsider)).toBe(false);
  });

  it("hides a note with no audience from regular members", () => {
    const note = { allMembers: false, groupIds: [] };
    expect(canViewReleaseNote(note, member)).toBe(false);
  });

  it("lets Core see everything, including a note with no audience", () => {
    expect(canViewReleaseNote({ allMembers: false, groupIds: [] }, core)).toBe(true);
    expect(canViewReleaseNote({ allMembers: false, groupIds: ["g1"] }, core)).toBe(true);
  });

  it("hides a group note from a viewer in no groups", () => {
    const note = { allMembers: false, groupIds: ["g1"] };
    expect(canViewReleaseNote(note, { isCore: false, groupIds: [] })).toBe(false);
  });
});

describe("hasUnseenReleaseNotes", () => {
  const seen = new Date("2026-10-10T12:00:00Z");
  const older = new Date("2026-10-09T12:00:00Z");
  const newer = new Date("2026-10-11T12:00:00Z");
  const open = { allMembers: true, groupIds: [] as string[] };

  it("is false with no notes", () => {
    expect(hasUnseenReleaseNotes([], member, null)).toBe(false);
  });

  it("is true when the viewer has never seen the page", () => {
    expect(hasUnseenReleaseNotes([{ ...open, publishedAt: older }], member, null)).toBe(true);
  });

  it("is false when every note predates the last visit", () => {
    expect(hasUnseenReleaseNotes([{ ...open, publishedAt: older }], member, seen)).toBe(false);
  });

  it("is false when a note was published at the moment of the last visit", () => {
    expect(hasUnseenReleaseNotes([{ ...open, publishedAt: seen }], member, seen)).toBe(false);
  });

  it("is true when a note is newer than the last visit", () => {
    expect(
      hasUnseenReleaseNotes(
        [
          { ...open, publishedAt: older },
          { ...open, publishedAt: newer },
        ],
        member,
        seen,
      ),
    ).toBe(true);
  });

  it("ignores newer notes the viewer cannot see", () => {
    const restricted = { allMembers: false, groupIds: ["g1"], publishedAt: newer };
    expect(hasUnseenReleaseNotes([restricted], outsider, seen)).toBe(false);
    expect(hasUnseenReleaseNotes([restricted], member, seen)).toBe(true);
  });

  it("ignores notes that are not published", () => {
    expect(hasUnseenReleaseNotes([{ ...open, publishedAt: null }], member, null)).toBe(false);
  });

  it("counts a restricted unseen note for Core", () => {
    const restricted = { allMembers: false, groupIds: ["g1"], publishedAt: newer };
    expect(hasUnseenReleaseNotes([restricted], core, seen)).toBe(true);
  });
});

describe("parsePrNumbers", () => {
  it("splits on commas and whitespace and strips #", () => {
    expect(parsePrNumbers("#2271, 2273 2275")).toEqual([2271, 2273, 2275]);
  });

  it("drops junk and duplicates", () => {
    expect(parsePrNumbers("12, abc, 12, #, 7x, 9")).toEqual([12, 9]);
  });

  it("returns an empty list for blank input", () => {
    expect(parsePrNumbers("  ")).toEqual([]);
  });
});

describe("releaseNoteAreaLabel", () => {
  it("labels known areas and passes unknown slugs through", () => {
    expect(releaseNoteAreaLabel("calendar")).toBe("Calendar");
    expect(releaseNoteAreaLabel("members")).toBe("People");
    expect(releaseNoteAreaLabel("legacy-thing")).toBe("legacy-thing");
    expect(releaseNoteAreaLabel(null)).toBeNull();
  });
});

describe("isReleaseNoteVideoKey", () => {
  it("accepts keys under the upload prefix, scoped or not", () => {
    expect(isReleaseNoteVideoKey("release-notes/uploads/x-demo.mp4")).toBe(true);
    expect(isReleaseNoteVideoKey("uploads/release-notes/uploads/x-demo.mp4")).toBe(true);
  });

  it("rejects keys elsewhere in the bucket", () => {
    expect(isReleaseNoteVideoKey("uploads/resumes/abc.pdf")).toBe(false);
    expect(isReleaseNoteVideoKey("release-notes/pr-12/demo.mp4")).toBe(false);
  });
});
