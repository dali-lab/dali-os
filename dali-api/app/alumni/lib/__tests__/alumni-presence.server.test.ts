import { describe, it, expect, beforeEach } from "vitest";
import { heartbeat, presenceCounts, leave, resetPresence } from "../alumni-presence.server";
import { SERVER_CAPACITY } from "~/components/alumni-game/servers";
import { DEFAULT_AVATAR } from "~/components/alumni-game/pixel-avatar";

const entry = (userId: string, x = 100, y = 100) => ({
  userId,
  name: userId,
  avatar: DEFAULT_AVATAR,
  x,
  y,
});

beforeEach(() => resetPresence());

describe("heartbeat", () => {
  it("shows players each other but not themselves", () => {
    heartbeat("lab-1", entry("a"));
    const res = heartbeat("lab-1", entry("b"));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.players.map((p) => p.userId)).toEqual(["a"]);
      expect(res.counts["lab-1"]).toBe(2);
    }
  });

  it("keeps servers isolated", () => {
    heartbeat("lab-1", entry("a"));
    const res = heartbeat("lab-2", entry("b"));
    if (res.ok) expect(res.players).toEqual([]);
    expect(presenceCounts()["lab-1"]).toBe(1);
    expect(presenceCounts()["lab-2"]).toBe(1);
  });

  it("moves a player who switches servers", () => {
    heartbeat("lab-1", entry("a"));
    heartbeat("lab-2", entry("a"));
    const counts = presenceCounts();
    expect(counts["lab-1"]).toBe(0);
    expect(counts["lab-2"]).toBe(1);
  });

  it("rejects a newcomer when the server is full, but keeps serving members", () => {
    for (let i = 0; i < SERVER_CAPACITY; i++) heartbeat("lab-1", entry(`u${i}`));
    const rejected = heartbeat("lab-1", entry("late"));
    expect(rejected.ok).toBe(false);
    const existing = heartbeat("lab-1", entry("u0"));
    expect(existing.ok).toBe(true);
    expect(presenceCounts()["lab-1"]).toBe(SERVER_CAPACITY);
  });

  it("prunes players whose heartbeats stopped", () => {
    const t0 = 1_000_000;
    heartbeat("lab-1", entry("a"), t0);
    heartbeat("lab-1", entry("b"), t0 + 9_000);
    expect(presenceCounts(t0 + 15_000)["lab-1"]).toBe(1);
    expect(presenceCounts(t0 + 30_000)["lab-1"]).toBe(0);
  });

  it("removes a player who leaves", () => {
    heartbeat("lab-1", entry("a"));
    leave("a");
    expect(presenceCounts()["lab-1"]).toBe(0);
  });
});
