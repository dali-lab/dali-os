import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/transcription/chunks.server", () => ({ deletePrefix: vi.fn() }));

import { prisma } from "~/lib/db.server";
import {
  MAX_ACTIVE_RECORDINGS,
  claimRecording,
  createRecording,
  recordChunk,
  requestStop,
  resumeRecording,
} from "~/lib/meeting-recording.server";
import { makeUser } from "../../../integration/factories-misc";

const DOC = "doc:note1:body";

describe("createRecording", () => {
  it("concurrent starts on one document: one row is created, the others are told it is busy", async () => {
    const users = await Promise.all(Array.from({ length: 5 }, () => makeUser()));
    const results = await Promise.all(users.map((u) => createRecording(u.id, DOC)));
    const created = results.filter((r) => r && "id" in r);
    const busy = results.filter((r) => r && "busy" in r);
    expect(created).toHaveLength(1);
    expect(busy).toHaveLength(4);
    expect(await prisma.meetingRecording.count({ where: { documentName: DOC } })).toBe(1);
  });

  it("a finished recording does not block a new one on the same document", async () => {
    const u = await makeUser();
    const first = (await createRecording(u.id, DOC)) as { id: string };
    await prisma.meetingRecording.update({ where: { id: first.id }, data: { status: "Done" } });
    const second = await createRecording(u.id, DOC);
    expect(second).toMatchObject({ status: "Pending", segmentStarts: [0] });
  });

  it("refuses new recordings once the lab-wide live cap is reached", async () => {
    const u = await makeUser();
    await prisma.meetingRecording.createMany({
      data: Array.from({ length: MAX_ACTIVE_RECORDINGS }, (_, i) => ({ userId: u.id, documentName: `doc:n${i}:body` })),
    });
    expect(await createRecording(u.id, "doc:other:body")).toBeNull();
  });

  it("purges the caller's abandoned (>24h, never finalized) recordings", async () => {
    const u = await makeUser();
    const old = await prisma.meetingRecording.create({ data: { userId: u.id, documentName: "doc:old:body" } });
    await prisma.$executeRaw`UPDATE "MeetingRecording" SET "createdAt" = now() - interval '25 hours' WHERE id = ${old.id}`;
    await createRecording(u.id, DOC);
    expect(await prisma.meetingRecording.findUnique({ where: { id: old.id } })).toBeNull();
  });
});

describe("recordChunk (row lock)", () => {
  it("mic and call chunks landing together both survive in channels and chunkIndex", async () => {
    const u = await makeUser();
    const rec = (await createRecording(u.id, DOC)) as { id: string };
    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => recordChunk(rec, "mic", 0, i, true)),
      ...Array.from({ length: 6 }, (_, i) => recordChunk(rec, "call", 0, i, false)),
    ]);
    const row = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } });
    expect([...row.channels].sort()).toEqual(["call", "mic"]);
    expect(row.chunkIndex).toEqual({ mic: [5], call: [5] });
    expect(row.voicedChannels).toEqual(["mic"]);
    expect(row.status).toBe("Recording");
    expect(row.sessionStartedAt).not.toBeNull();
  });

  it("keeps the high-water seq when an older chunk arrives late and pads skipped segments", async () => {
    const u = await makeUser();
    const rec = (await createRecording(u.id, DOC)) as { id: string };
    await recordChunk(rec, "mic", 0, 9, true);
    await recordChunk(rec, "mic", 0, 3, true);
    await recordChunk(rec, "mic", 2, 1, true);
    const row = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } });
    expect(row.chunkIndex).toEqual({ mic: [9, -1, 1] });
  });

  it("reports stopRequested set by the page and treats a deleted row as stopped", async () => {
    const u = await makeUser();
    const rec = (await createRecording(u.id, DOC)) as { id: string; status: "Pending" };
    await recordChunk(rec, "mic", 0, 0, true);
    await requestStop({ id: rec.id, status: "Recording" });
    expect(await recordChunk(rec, "mic", 0, 1, true)).toEqual({ stopRequested: true });
    expect(await recordChunk({ id: "gone" }, "mic", 0, 0, true)).toEqual({ stopRequested: true });
  });
});

describe("state transitions", () => {
  it("claim moves Pending to Recording once and refuses terminal states", async () => {
    const u = await makeUser();
    const rec = await createRecording(u.id, DOC);
    const r = rec as Parameters<typeof claimRecording>[0];
    expect(await claimRecording(r)).toEqual({ ok: true, offset: 0, segment: 0 });
    expect((await prisma.meetingRecording.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("Recording");
    await prisma.meetingRecording.update({ where: { id: r.id }, data: { status: "Done" } });
    const done = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: r.id } });
    expect(await claimRecording(done)).toEqual({ ok: false });
  });

  it("stopping a Pending recording ends it outright", async () => {
    const u = await makeUser();
    const rec = (await createRecording(u.id, DOC)) as { id: string };
    await requestStop({ id: rec.id, status: "Pending" });
    expect(await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({
      status: "Stopped",
      stopRequested: true,
    });
  });

  it("resume pushes a segment at the recorded seconds, and is refused once finalized", async () => {
    const u = await makeUser();
    const rec = (await createRecording(u.id, DOC)) as { id: string };
    await prisma.meetingRecording.update({
      where: { id: rec.id },
      data: { status: "Stopped", stopRequested: true, recordedSeconds: 42.5, error: "x" },
    });
    const stopped = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } });
    expect(await resumeRecording(stopped)).toBe(true);
    const after = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } });
    expect(after).toMatchObject({ status: "Pending", stopRequested: false, error: null, segmentStarts: [0, 42.5] });
    expect(await claimRecording(after)).toEqual({ ok: true, offset: 42.5, segment: 1 });

    await prisma.meetingRecording.update({ where: { id: rec.id }, data: { status: "Stopped", finalizedAt: new Date() } });
    const fin = await prisma.meetingRecording.findUniqueOrThrow({ where: { id: rec.id } });
    expect(await resumeRecording(fin)).toBe(false);
  });
});
