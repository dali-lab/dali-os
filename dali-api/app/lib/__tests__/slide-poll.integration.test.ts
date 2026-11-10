import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "~/lib/db.server";

const PAGE = "poll-page-1";
let presentationId: string;

beforeEach(async () => {
  const host = await prisma.user.create({ data: { id: "poll-host", email: "ada@example.edu", firstName: "Ada", lastName: "Lovelace" } });
  await prisma.user.create({ data: { id: "poll-guest", email: "grace@example.edu", firstName: "Grace", lastName: "Hopper" } });
  await prisma.page.create({ data: { id: PAGE, workspaceType: "Lab", title: "Deck", kind: "Slides", createdById: host.id } });
  const presentation = await prisma.slidePresentation.create({ data: { pageId: PAGE, presenterId: host.id, slideId: "s1" } });
  presentationId = presentation.id;
});

const vote = (userId: string, choices: number[], pollElementId = "poll1") => ({ presentationId, pollElementId, userId, choices });

describe("SlidePollVote", () => {
  it("allows one vote per person per poll per presentation", async () => {
    await prisma.slidePollVote.create({ data: vote("poll-guest", [0]) });
    await expect(prisma.slidePollVote.create({ data: vote("poll-guest", [1]) })).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.slidePollVote.count()).toBe(1);
  });

  it("lets the same person vote on a different poll, and others on the same one", async () => {
    await prisma.slidePollVote.create({ data: vote("poll-guest", [0]) });
    await prisma.slidePollVote.create({ data: vote("poll-guest", [0], "poll2") });
    await prisma.slidePollVote.create({ data: vote("poll-host", [1]) });
    expect(await prisma.slidePollVote.count()).toBe(3);
  });

  it("changes a vote by upserting on the unique key", async () => {
    const key = { presentationId, pollElementId: "poll1", userId: "poll-guest" };
    await prisma.slidePollVote.upsert({ where: { presentationId_pollElementId_userId: key }, create: { ...key, choices: [0] }, update: { choices: [0] } });
    await prisma.slidePollVote.upsert({ where: { presentationId_pollElementId_userId: key }, create: { ...key, choices: [2, 1] }, update: { choices: [2, 1] } });
    const rows = await prisma.slidePollVote.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].choices).toEqual([2, 1]);
  });

  it("clears a deck's votes when a new presentation starts", async () => {
    await prisma.slidePollVote.create({ data: vote("poll-guest", [0]) });
    await prisma.slidePollVote.deleteMany({ where: { presentation: { pageId: PAGE } } });
    expect(await prisma.slidePollVote.count()).toBe(0);
  });

  it("goes away with the presentation", async () => {
    await prisma.slidePollVote.create({ data: vote("poll-guest", [0]) });
    await prisma.slidePresentation.delete({ where: { id: presentationId } });
    expect(await prisma.slidePollVote.count()).toBe(0);
  });

  it("starts a presentation with no closed polls and reactions on", async () => {
    const row = await prisma.slidePresentation.findUniqueOrThrow({ where: { id: presentationId } });
    expect(row.closedPolls).toEqual([]);
    expect(row.reactionsOff).toBe(false);
  });
});
