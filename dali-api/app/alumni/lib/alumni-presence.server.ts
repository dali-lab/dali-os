import {
  LAB_SERVERS,
  SERVER_CAPACITY,
  type LabServerId,
} from "~/components/alumni-game/servers";
import type { AvatarConfig } from "~/components/alumni-game/pixel-avatar";

// In-memory, ephemeral presence per lab server: who is where, refreshed by a
// sub-second client heartbeat and pruned on read. Single-process state — on a
// multi-machine deploy each machine sees its own players, which is acceptable
// for this casual layer.

export type PresenceEntry = {
  userId: string;
  name: string;
  avatar: AvatarConfig;
  x: number;
  y: number;
  ts: number;
};

const TTL_MS = 10_000;

const rooms = new Map<LabServerId, Map<string, PresenceEntry>>();

function room(server: LabServerId): Map<string, PresenceEntry> {
  let r = rooms.get(server);
  if (!r) {
    r = new Map();
    rooms.set(server, r);
  }
  return r;
}

function prune(now: number) {
  for (const r of rooms.values()) {
    for (const [id, entry] of r) {
      if (now - entry.ts > TTL_MS) r.delete(id);
    }
  }
}

export function presenceCounts(now = Date.now()): Record<string, number> {
  prune(now);
  return Object.fromEntries(LAB_SERVERS.map((s) => [s.id, rooms.get(s.id)?.size ?? 0]));
}

export type HeartbeatResult =
  | { ok: true; players: PresenceEntry[]; counts: Record<string, number> }
  | { ok: false; error: "full"; counts: Record<string, number> };

export function heartbeat(
  server: LabServerId,
  entry: Omit<PresenceEntry, "ts">,
  now = Date.now(),
): HeartbeatResult {
  prune(now);
  // Switching servers removes the player everywhere else first.
  for (const [id, r] of rooms) {
    if (id !== server) r.delete(entry.userId);
  }
  const r = room(server);
  if (!r.has(entry.userId) && r.size >= SERVER_CAPACITY) {
    return { ok: false, error: "full", counts: presenceCounts(now) };
  }
  r.set(entry.userId, { ...entry, ts: now });
  const players = [...r.values()].filter((p) => p.userId !== entry.userId);
  return { ok: true, players, counts: presenceCounts(now) };
}

export function leave(userId: string) {
  for (const r of rooms.values()) r.delete(userId);
}

export function resetPresence() {
  rooms.clear();
}
