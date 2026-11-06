import { z } from "zod";
import { prisma } from "~/lib/db.server";
import { publish } from "~/lib/realtime-bus.server";
import { deckAccess, readDeckModel } from "~/lib/slide-decks.server";
import { slideLiveTopic } from "~/lib/slide-live.server";
import { MAX_POLL_OPTIONS } from "~/components/slides/deck/content";
import type { PollResult } from "~/components/slides/deck/content-render";
import { REACTIONS, REACTION_INTERVAL_MS, NO_POLLS, type PollsState } from "~/components/slides/live/polls";

export const slidePollTopic = (pageId: string) => `slide-poll:${pageId}`;
export const slideReactTopic = (pageId: string) => `slide-react:${pageId}`;

export const pollIntentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("vote"), pollId: z.string().min(1).max(100), choices: z.array(z.number().int().min(0).max(MAX_POLL_OPTIONS - 1)).max(MAX_POLL_OPTIONS) }),
  z.object({ intent: z.literal("close"), pollId: z.string().min(1).max(100) }),
  z.object({ intent: z.literal("open"), pollId: z.string().min(1).max(100) }),
  z.object({ intent: z.literal("reset"), pollId: z.string().min(1).max(100) }),
  z.object({ intent: z.literal("reactions"), off: z.boolean() }),
]);
export type PollIntent = z.infer<typeof pollIntentSchema>;

export const reactionSchema = z.object({ emoji: z.string().min(1).max(16) });

export type PollsResult = { ok: true; state: PollsState } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

const activeRow = (pageId: string) =>
  prisma.slidePresentation.findUnique({
    where: { pageId },
    select: { id: true, presenterId: true, endedAt: true, closedPolls: true, reactionsOff: true },
  });

async function stateFor(userId: string, row: { id: string; closedPolls: string[] }): Promise<PollsState> {
  const votes = await prisma.slidePollVote.findMany({
    where: { presentationId: row.id },
    select: { pollElementId: true, userId: true, choices: true },
  });
  const polls: Record<string, PollResult> = {};
  const poll = (id: string) =>
    (polls[id] ??= { counts: Array.from({ length: MAX_POLL_OPTIONS }, () => 0), total: 0, mine: [], closed: row.closedPolls.includes(id) });
  for (const id of row.closedPolls) poll(id);
  for (const vote of votes) {
    const result = poll(vote.pollElementId);
    result.total += 1;
    for (const c of vote.choices) if (c >= 0 && c < MAX_POLL_OPTIONS) result.counts[c] += 1;
    if (vote.userId === userId) result.mine = vote.choices;
  }
  return { active: true, polls };
}

export async function readPolls(userId: string, pageId: string, request?: Request): Promise<PollsResult> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  const row = await activeRow(pageId);
  if (!row || row.endedAt) return { ok: true, state: NO_POLLS };
  return { ok: true, state: await stateFor(userId, row) };
}

async function pollSpec(pageId: string, pollId: string) {
  const read = await readDeckModel(pageId);
  for (const slide of read.slides) {
    const el = slide.elements.find((e) => e.id === pollId && e.kind === "poll");
    if (el?.poll) return el.poll;
  }
  return null;
}

export async function applyPoll(userId: string, pageId: string, input: PollIntent, request?: Request): Promise<PollsResult> {
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  const row = await activeRow(pageId);
  if (!row || row.endedAt) return fail(409, "Nobody is presenting.");

  if (input.intent === "vote") {
    const poll = await pollSpec(pageId, input.pollId);
    if (!poll) return fail(404, "Poll not found.");
    if (row.closedPolls.includes(input.pollId)) return fail(409, "Voting is closed.");
    const choices = [...new Set(input.choices)].sort((a, b) => a - b);
    if (choices.some((c) => c >= poll.options.length)) return fail(400, "That option doesn't exist.");
    if (choices.length > (poll.multi ? poll.options.length : 1)) return fail(400, "This poll takes one answer.");
    const key = { presentationId: row.id, pollElementId: input.pollId, userId };
    if (choices.length === 0) await prisma.slidePollVote.deleteMany({ where: key });
    else {
      await prisma.slidePollVote.upsert({
        where: { presentationId_pollElementId_userId: key },
        create: { ...key, choices },
        update: { choices },
      });
    }
    publish(slidePollTopic(pageId));
    return { ok: true, state: await stateFor(userId, row) };
  }

  if (row.presenterId !== userId) return fail(403, "Only the presenter can do that.");

  if (input.intent === "reactions") {
    if (row.reactionsOff !== input.off) {
      await prisma.slidePresentation.update({ where: { pageId }, data: { reactionsOff: input.off } });
      publish(slideLiveTopic(pageId));
    }
    return { ok: true, state: await stateFor(userId, row) };
  }

  if (input.intent === "reset") {
    await prisma.slidePollVote.deleteMany({ where: { presentationId: row.id, pollElementId: input.pollId } });
  } else {
    const closed = new Set(row.closedPolls);
    if (input.intent === "close") closed.add(input.pollId);
    else closed.delete(input.pollId);
    row.closedPolls = [...closed];
    await prisma.slidePresentation.update({ where: { pageId }, data: { closedPolls: row.closedPolls } });
  }
  publish(slidePollTopic(pageId));
  return { ok: true, state: await stateFor(userId, row) };
}

const lastReaction = new Map<string, number>();

export function __resetReactionLimitForTests(): void {
  lastReaction.clear();
}

export async function sendReaction(userId: string, pageId: string, emoji: string, request?: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!(REACTIONS as readonly string[]).includes(emoji)) return fail(400, "Pick one of the reactions.");
  const access = await deckAccess(userId, pageId, request);
  if (!access.ok) return access;
  const row = await activeRow(pageId);
  if (!row || row.endedAt) return fail(409, "Nobody is presenting.");
  if (row.reactionsOff) return fail(409, "Reactions are off.");
  const now = Date.now();
  const key = `${pageId}:${userId}`;
  const last = lastReaction.get(key);
  if (last !== undefined && now - last < REACTION_INTERVAL_MS) return fail(429, "Slow down a little.");
  lastReaction.set(key, now);
  if (lastReaction.size > 5000) for (const [k, t] of lastReaction) if (now - t > 60_000) lastReaction.delete(k);
  publish(slideReactTopic(pageId), JSON.stringify({ emoji, id: `${now}-${Math.random().toString(36).slice(2, 8)}` }));
  return { ok: true };
}
