import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { slidePresentation: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("~/lib/realtime-bus.server", () => ({ publish: vi.fn() }));
vi.mock("~/lib/slide-decks.server", () => ({ deckAccess: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(async () => ({})) }));

import { prisma } from "~/lib/db.server";
import { publish } from "~/lib/realtime-bus.server";
import { deckAccess } from "~/lib/slide-decks.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { applyLive, liveIntentSchema, readLive, slideLiveTopic, slidesLiveEnabled } from "../slide-live.server";

const db = prisma.slidePresentation as unknown as Record<"findUnique" | "update" | "upsert", ReturnType<typeof vi.fn>>;
const access = vi.mocked(deckAccess);

const row = (over: Record<string, unknown> = {}) => ({
  presenterId: "u1",
  slideId: "s1",
  build: 0,
  startedAt: new Date("2026-11-05T12:00:00Z"),
  endedAt: null,
  presenter: { firstName: "Ada", lastName: "Lovelace" },
  ...over,
});

function asAccess(canEdit: boolean) {
  access.mockResolvedValue({ ok: true, page: { id: "p1", title: "T", iconEmoji: null }, canEdit });
}

beforeEach(() => {
  vi.resetAllMocks();
  asAccess(true);
  db.findUnique.mockResolvedValue(null);
});

describe("readLive", () => {
  it("returns inactive when nobody is presenting", async () => {
    expect(await readLive("u2", "p1")).toEqual({
      ok: true,
      live: { active: false, slideId: null, build: 0, presenter: null, startedAt: null },
    });
  });

  it("returns the live slide and presenter name to a viewer", async () => {
    asAccess(false);
    db.findUnique.mockResolvedValue(row({ slideId: "s3", build: 2 }));
    expect(await readLive("u2", "p1")).toEqual({
      ok: true,
      live: { active: true, slideId: "s3", build: 2, presenter: { id: "u1", name: "Ada Lovelace" }, startedAt: "2026-11-05T12:00:00.000Z" },
    });
  });

  it("reads an ended presentation as inactive", async () => {
    db.findUnique.mockResolvedValue(row({ endedAt: new Date() }));
    expect((await readLive("u2", "p1")) as { live: { active: boolean } }).toMatchObject({ live: { active: false } });
  });

  it("passes through a deck access failure", async () => {
    access.mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(await readLive("u2", "p1")).toEqual({ ok: false, status: 404, error: "Slide deck not found." });
  });
});

describe("applyLive", () => {
  it("rejects a viewer who cannot edit", async () => {
    asAccess(false);
    const res = await applyLive("u2", "p1", { intent: "start", slideId: "s1" });
    expect(res).toMatchObject({ ok: false, status: 403 });
    expect(db.upsert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("starts a presentation and publishes once", async () => {
    db.upsert.mockResolvedValue({});
    db.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ presenterId: "u1" }));
    const res = await applyLive("u1", "p1", { intent: "start", slideId: "s1" });
    expect(res).toMatchObject({ ok: true, live: { active: true, slideId: "s1" } });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { pageId: "p1" },
        update: expect.objectContaining({ presenterId: "u1", endedAt: null }),
      }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(slideLiveTopic("p1"));
  });

  it("lets another editor take over by starting", async () => {
    db.findUnique.mockResolvedValueOnce(row({ presenterId: "u1" })).mockResolvedValueOnce(row({ presenterId: "u2" }));
    await applyLive("u2", "p1", { intent: "start", slideId: "s2" });
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ presenterId: "u2", slideId: "s2", startedAt: expect.any(Date) }) }),
    );
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("drops a start that repeats the presenter's own position", async () => {
    db.findUnique.mockResolvedValue(row());
    await applyLive("u1", "p1", { intent: "start", slideId: "s1" });
    expect(db.upsert).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("moves the deck for the presenter and publishes", async () => {
    db.findUnique.mockResolvedValue(row());
    const res = await applyLive("u1", "p1", { intent: "go", slideId: "s2", build: 1 });
    expect(res).toMatchObject({ ok: true, live: { slideId: "s2", build: 1 } });
    expect(db.update).toHaveBeenCalledWith({ where: { pageId: "p1" }, data: { slideId: "s2", build: 1 } });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("ignores a go to where the deck already is", async () => {
    db.findUnique.mockResolvedValue(row());
    const res = await applyLive("u1", "p1", { intent: "go", slideId: "s1" });
    expect(res.ok).toBe(true);
    expect(db.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects go from an editor who is not the presenter", async () => {
    db.findUnique.mockResolvedValue(row({ presenterId: "u1" }));
    expect(await applyLive("u2", "p1", { intent: "go", slideId: "s2" })).toMatchObject({ ok: false, status: 403 });
    expect(db.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("rejects go when nobody is presenting", async () => {
    expect(await applyLive("u1", "p1", { intent: "go", slideId: "s2" })).toMatchObject({ ok: false, status: 409 });
  });

  it("ends for the presenter and publishes", async () => {
    db.findUnique.mockResolvedValue(row());
    const res = await applyLive("u1", "p1", { intent: "end" });
    expect(res).toMatchObject({ ok: true, live: { active: false } });
    expect(db.update).toHaveBeenCalledWith({ where: { pageId: "p1" }, data: { endedAt: expect.any(Date) } });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("rejects end from a non-presenter", async () => {
    db.findUnique.mockResolvedValue(row({ presenterId: "u1" }));
    expect(await applyLive("u2", "p1", { intent: "end" })).toMatchObject({ ok: false, status: 403 });
    expect(db.update).not.toHaveBeenCalled();
  });

  it("treats end with no live presentation as a no-op", async () => {
    expect(await applyLive("u1", "p1", { intent: "end" })).toMatchObject({ ok: true, live: { active: false } });
    expect(db.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("liveIntentSchema", () => {
  it("accepts the three intents and rejects bad input", () => {
    expect(liveIntentSchema.safeParse({ intent: "end" }).success).toBe(true);
    expect(liveIntentSchema.safeParse({ intent: "go", slideId: "s1", build: 2 }).success).toBe(true);
    expect(liveIntentSchema.safeParse({ intent: "go", slideId: "" }).success).toBe(false);
    expect(liveIntentSchema.safeParse({ intent: "go", slideId: "s1", build: -1 }).success).toBe(false);
    expect(liveIntentSchema.safeParse({ intent: "nope" }).success).toBe(false);
  });
});

describe("slidesLiveEnabled", () => {
  it("follows the slides-live flag", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
    expect(await slidesLiveEnabled("u1")).toBe(true);
    expect(isFeatureEnabled).toHaveBeenCalledWith("slides-live", "u1", {}, undefined);
  });
});
