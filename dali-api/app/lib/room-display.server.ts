// Door-display identity. A RoomDisplay authenticates with its own bearer token
// (not a user Session), minted when the iPad redeems a Core-issued setup code.
// requireAuth never sees these tokens: they only open /api/room-display/*,
// scoped to the display's one room.

import { prisma } from "~/lib/db";
import { generateRawCode, generateUserCode, hashCode, normalizeUserCode } from "~/lib/pairing";

export const SETUP_CODE_TTL_MS = 10 * 60 * 1000;
// lastSeenAt is informational (Core's "last check-in" column); don't write it
// on every 30s poll.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export type AuthedDisplay = {
  id: string;
  label: string;
  room: { id: string; name: string; description: string | null; capacity: number | null };
};

/** Mint a fresh single-use setup code for a new display on `roomId`. */
export async function createDisplaySetupCode(roomId: string, label: string, createdByUserId: string) {
  const code = generateUserCode();
  const expiresAt = new Date(Date.now() + SETUP_CODE_TTL_MS);
  const display = await prisma.roomDisplay.create({
    data: {
      roomId,
      label,
      createdByUserId,
      setupCodeHash: hashCode(code),
      setupCodeExpiresAt: expiresAt,
    },
    select: { id: true },
  });
  return { displayId: display.id, code, expiresAt };
}

/** Redeem a setup code for the display's long-lived token. Single use. */
export async function redeemDisplaySetupCode(rawCode: string) {
  const setupCodeHash = hashCode(normalizeUserCode(rawCode));
  const display = await prisma.roomDisplay.findUnique({
    where: { setupCodeHash },
    select: { id: true, setupCodeExpiresAt: true, revokedAt: true },
  });
  if (!display || display.revokedAt || !display.setupCodeExpiresAt || display.setupCodeExpiresAt < new Date()) {
    return null;
  }
  const token = generateRawCode();
  // Guarded on the hash so a concurrent redeem of the same code can't mint twice.
  const claimed = await prisma.roomDisplay.updateMany({
    where: { id: display.id, setupCodeHash },
    data: {
      setupCodeHash: null,
      setupCodeExpiresAt: null,
      tokenHash: hashCode(token),
      activatedAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
  if (claimed.count === 0) return null;
  return { token, displayId: display.id };
}

export async function requireRoomDisplay(request: Request): Promise<AuthedDisplay | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^RoomDisplay\s+(\S+)$/i.exec(header);
  if (!match) return null;
  const display = await prisma.roomDisplay.findUnique({
    where: { tokenHash: hashCode(match[1]) },
    select: {
      id: true,
      label: true,
      revokedAt: true,
      lastSeenAt: true,
      room: { select: { id: true, name: true, description: true, capacity: true, archivedAt: true } },
    },
  });
  if (!display || display.revokedAt || display.room.archivedAt) return null;

  if (!display.lastSeenAt || Date.now() - display.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    prisma.roomDisplay
      .update({ where: { id: display.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }
  const { archivedAt: _archived, ...room } = display.room;
  return { id: display.id, label: display.label, room };
}

export function displayUnauthorized() {
  return Response.json({ error: "Display not paired" }, { status: 401 });
}
