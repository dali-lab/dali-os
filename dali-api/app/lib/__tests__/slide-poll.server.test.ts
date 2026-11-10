import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  slidePresentation: { findUnique: vi.fn(), update: vi.fn() },
  slidePollVote: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock("~/lib/db.server", () => ({ prisma: db }));
vi.mock("~/lib/realtime-bus.server", () => ({ publish: vi.fn() }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn(), readDeckModel: vi.fn() }));
vi.mock("~/lib/slide-live.server", () => ({ slideLiveTopic: (id: string) => `slide-live:${id}` }));

import { publish } from "~/lib/realtime-bus.server";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { __resetReactionLimitForTests, applyPoll, pollIntentSchema, readPolls, reactionSchema, sendReaction, slidePollTopic, slideReactTopic } from "../slide-poll.server";

const ROW = { id: "pres1", presenterId: "host", endedAt: null as Date | null, closedPolls: [] as string[], reactionsOff: false };
const SINGLE = { question: "Ship it?", options: ["Yes", "No", "Later"] };
const MULTI = { question: "Pick", options: ["A", "B", "C"], multi: true };

function deck(polls: Record<string, unknown>) {
  vi.mocked(readDeckModel).mockResolvedValue({
    slides: [{ id: "s1", elements: Object.entries(polls).map(([id, poll]) => ({ id, kind: "poll", poll })) }],
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(deckAccess).mockResolvedValue({ ok: true, page: { id: "p1", title: "T", iconEmoji: null }, canEdit: false, canComment: false });
  db.slidePresentation.findUnique.mockResolvedValue({ ...ROW });
  db.slidePollVote.findMany.mockResolvedValue([]);
  deck({ poll1: SINGLE, poll2: MULTI });
  __resetReactionLimitForTests();
});

describe("readPolls", () => {
  it("is empty when nobody is presenting", async () => {
    db.slidePresentation.findUnique.mockResolvedValue(null);
    expect(await readPolls("u1", "p1")).toEqual({ ok: true, state: { active: false, polls: {} } });
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, endedAt: new Date() });
    expect(await readPolls("u1", "p1")).toEqual({ ok: true, state: { active: false, polls: {} } });
  });

  it("counts every vote, marks the caller's own, and lists closed polls", async () => {
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, closedPolls: ["poll1", "poll9"] });
    db.slidePollVote.findMany.mockResolvedValue([
      { pollElementId: "poll1", userId: "u1", choices: [0] },
      { pollElementId: "poll1", userId: "u2", choices: [0] },
      { pollElementId: "poll2", userId: "u2", choices: [1, 2] },
    ]);
    const res = await readPolls("u1", "p1");
    expect(res).toMatchObject({ ok: true, state: { active: true } });
    const polls = (res as { state: { polls: Record<string, { counts: number[]; total: number; mine: number[]; closed: boolean }> } }).state.polls;
    expect(polls.poll1).toMatchObject({ counts: [2, 0, 0, 0, 0, 0], total: 2, mine: [0], closed: true });
    expect(polls.poll2).toMatchObject({ counts: [0, 1, 1, 0, 0, 0], total: 1, mine: [], closed: false });
    expect(polls.poll9).toMatchObject({ total: 0, closed: true });
  });

  it("passes a deck access failure through", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(await readPolls("u1", "p1")).toEqual({ ok: false, status: 404, error: "Slide deck not found." });
  });
});

describe("voting", () => {
  const vote = (pollId: string, choices: number[], user = "u1") => applyPoll(user, "p1", { intent: "vote", pollId, choices });

  it("stores one vote per person per poll by upserting on the unique key, and publishes", async () => {
    await vote("poll1", [1]);
    expect(db.slidePollVote.upsert).toHaveBeenCalledWith({
      where: { presentationId_pollElementId_userId: { presentationId: "pres1", pollElementId: "poll1", userId: "u1" } },
      create: { presentationId: "pres1", pollElementId: "poll1", userId: "u1", choices: [1] },
      update: { choices: [1] },
    });
    expect(publish).toHaveBeenCalledWith(slidePollTopic("p1"));
  });

  it("changes a vote with another vote rather than adding a second", async () => {
    await vote("poll1", [0]);
    await vote("poll1", [2]);
    expect(db.slidePollVote.upsert).toHaveBeenCalledTimes(2);
    expect(db.slidePollVote.upsert.mock.calls[1][0].update).toEqual({ choices: [2] });
  });

  it("removes a vote when the choices are empty", async () => {
    await vote("poll1", []);
    expect(db.slidePollVote.deleteMany).toHaveBeenCalledWith({ where: { presentationId: "pres1", pollElementId: "poll1", userId: "u1" } });
    expect(db.slidePollVote.upsert).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalled();
  });

  it("sorts and de-duplicates several answers on a poll that allows them", async () => {
    await vote("poll2", [2, 0, 2]);
    expect(db.slidePollVote.upsert.mock.calls[0][0].create.choices).toEqual([0, 2]);
  });

  it("allows only one answer on a single-answer poll", async () => {
    expect(await vote("poll1", [0, 1])).toMatchObject({ ok: false, status: 400 });
    expect(db.slidePollVote.upsert).not.toHaveBeenCalled();
  });

  it("rejects an option the poll does not have", async () => {
    expect(await vote("poll1", [3])).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a poll that is not in the deck", async () => {
    expect(await vote("nope", [0])).toMatchObject({ ok: false, status: 404 });
  });

  it("rejects a vote on a closed poll without writing or publishing", async () => {
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, closedPolls: ["poll1"] });
    expect(await vote("poll1", [0])).toMatchObject({ ok: false, status: 409 });
    expect(db.slidePollVote.upsert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects a vote when nobody is presenting", async () => {
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, endedAt: new Date() });
    expect(await vote("poll1", [0])).toMatchObject({ ok: false, status: 409 });
  });

  it("rejects someone who cannot see the deck", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(await vote("poll1", [0])).toMatchObject({ ok: false, status: 404 });
    expect(db.slidePollVote.upsert).not.toHaveBeenCalled();
  });

  it("lets a viewer who cannot edit vote", async () => {
    expect(await vote("poll1", [0])).toMatchObject({ ok: true });
  });
});

describe("presenter controls", () => {
  const as = (intent: Record<string, unknown>, user = "host") => applyPoll(user, "p1", intent as never);

  it("lets only the presenter close, reopen, reset and switch reactions", async () => {
    for (const intent of [{ intent: "close", pollId: "poll1" }, { intent: "open", pollId: "poll1" }, { intent: "reset", pollId: "poll1" }, { intent: "reactions", off: true }]) {
      expect(await as(intent, "guest")).toMatchObject({ ok: false, status: 403 });
    }
    expect(db.slidePresentation.update).not.toHaveBeenCalled();
    expect(db.slidePollVote.deleteMany).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("closes a poll and publishes", async () => {
    await as({ intent: "close", pollId: "poll1" });
    expect(db.slidePresentation.update).toHaveBeenCalledWith({ where: { pageId: "p1" }, data: { closedPolls: ["poll1"] } });
    expect(publish).toHaveBeenCalledWith(slidePollTopic("p1"));
  });

  it("reopens a closed poll", async () => {
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, closedPolls: ["poll1", "poll2"] });
    await as({ intent: "open", pollId: "poll1" });
    expect(db.slidePresentation.update).toHaveBeenCalledWith({ where: { pageId: "p1" }, data: { closedPolls: ["poll2"] } });
  });

  it("resets one poll's votes", async () => {
    await as({ intent: "reset", pollId: "poll2" });
    expect(db.slidePollVote.deleteMany).toHaveBeenCalledWith({ where: { presentationId: "pres1", pollElementId: "poll2" } });
    expect(publish).toHaveBeenCalledWith(slidePollTopic("p1"));
  });

  it("turns reactions off on the live topic, and does nothing when already so", async () => {
    await as({ intent: "reactions", off: true });
    expect(db.slidePresentation.update).toHaveBeenCalledWith({ where: { pageId: "p1" }, data: { reactionsOff: true } });
    expect(publish).toHaveBeenCalledWith("slide-live:p1");
    vi.clearAllMocks();
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, reactionsOff: true });
    db.slidePollVote.findMany.mockResolvedValue([]);
    await as({ intent: "reactions", off: true });
    expect(db.slidePresentation.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("intent schema", () => {
  it("rejects out-of-range, fractional and oversized choices", () => {
    expect(pollIntentSchema.safeParse({ intent: "vote", pollId: "a", choices: [6] }).success).toBe(false);
    expect(pollIntentSchema.safeParse({ intent: "vote", pollId: "a", choices: [0.5] }).success).toBe(false);
    expect(pollIntentSchema.safeParse({ intent: "vote", pollId: "a", choices: [0, 1, 2, 3, 4, 5, 5] }).success).toBe(false);
    expect(pollIntentSchema.safeParse({ intent: "vote", pollId: "a", choices: [0, 5] }).success).toBe(true);
  });
});

describe("reactions", () => {
  it("publishes the emoji on the reaction topic with a payload", async () => {
    expect(await sendReaction("u1", "p1", "🎉")).toEqual({ ok: true });
    expect(publish).toHaveBeenCalledWith(slideReactTopic("p1"), expect.any(String));
    const payload = JSON.parse(vi.mocked(publish).mock.calls[0][1]!);
    expect(payload.emoji).toBe("🎉");
    expect(typeof payload.id).toBe("string");
    expect(JSON.stringify(payload)).not.toContain("u1");
  });

  it("rejects an emoji outside the set", async () => {
    expect(await sendReaction("u1", "p1", "💩")).toMatchObject({ ok: false, status: 400 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("allows one reaction a second per person and lets others through", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: true });
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: false, status: 429 });
    expect(await sendReaction("u2", "p1", "👍")).toMatchObject({ ok: true });
    vi.setSystemTime(new Date("2026-11-05T12:00:01.100Z"));
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: true });
    expect(publish).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("rejects when reactions are off or nobody is presenting", async () => {
    db.slidePresentation.findUnique.mockResolvedValue({ ...ROW, reactionsOff: true });
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: false, status: 409 });
    db.slidePresentation.findUnique.mockResolvedValue(null);
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: false, status: 409 });
    expect(publish).not.toHaveBeenCalled();
  });

  it("requires access to the deck", async () => {
    vi.mocked(deckAccess).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(await sendReaction("u1", "p1", "👍")).toMatchObject({ ok: false, status: 404 });
  });

  it("validates the request body", () => {
    expect(reactionSchema.safeParse({ emoji: "👍" }).success).toBe(true);
    expect(reactionSchema.safeParse({ emoji: "" }).success).toBe(false);
    expect(reactionSchema.safeParse({}).success).toBe(false);
  });
});
