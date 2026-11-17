// The virtual lab's map data, in world pixels of the 2560x1440 scene art.
// Overlay x/y are where each cropped open-state sheet draws back onto the
// base layer. Collision is tested against the avatar's feet point only, so
// the character can stand "in front of" furniture naturally.

export const WORLD = { width: 2560, height: 1440 } as const;

export const AVATAR_WORLD_HEIGHT = 200;
export const SPAWN = { x: 1280, y: 980 } as const;
export const INTERACT_RADIUS = 150;

export type Interactable = {
  id: string;
  label: string;
  // Where the open-state art draws, its on-screen extent (the clickable art),
  // the point the player walks to, and the line shown after opening it.
  overlay: { x: number; y: number };
  rect: { x: number; y: number; w: number; h: number };
  at: { x: number; y: number };
  flavor: string;
};

export const INTERACTABLES: Interactable[] = [
  { id: "fridge", label: "the fridge", overlay: { x: 780, y: 128 }, rect: { x: 780, y: 128, w: 64, h: 172 }, at: { x: 860, y: 320 }, flavor: "For some reason, we have a lot of tangerines." },
  { id: "cabinet-1", label: "the black fridge", overlay: { x: 936, y: 312 }, rect: { x: 936, y: 312, w: 112, h: 168 }, at: { x: 990, y: 490 }, flavor: "Something smells a bit funky in here." },
  { id: "cabinet-2", label: "the cabinet", overlay: { x: 1380, y: 264 }, rect: { x: 1380, y: 264, w: 120, h: 144 }, at: { x: 1430, y: 430 }, flavor: "This cabinet is completely empty." },
  { id: "pizza", label: "the pizza box", overlay: { x: 1920, y: 364 }, rect: { x: 1920, y: 364, w: 108, h: 132 }, at: { x: 1974, y: 650 }, flavor: "There are only a few vegetable pizzas left." },
  { id: "pod-appa", label: "pod APPA", overlay: { x: 828, y: 1044 }, rect: { x: 828, y: 1044, w: 160, h: 216 }, at: { x: 904, y: 1040 }, flavor: "Someone left a blanket in here. Cozy." },
  { id: "pod-momo", label: "pod MOMO", overlay: { x: 2160, y: 1044 }, rect: { x: 2160, y: 1044, w: 160, h: 216 }, at: { x: 2240, y: 1050 }, flavor: "The best nap spot in the lab, no contest." },
];

export type Npc = {
  id: "tim" | "lorie";
  name: string;
  // Feet center: the shadow painted on the lab floor.
  at: { x: number; y: number };
  height: number;
};

export const NPCS: Npc[] = [
  { id: "lorie", name: "Lorie", at: { x: 201, y: 679 }, height: 200 },
  { id: "tim", name: "Tim", at: { x: 2429, y: 859 }, height: 220 },
];

// Rectangles the avatar's feet can't enter: walls, counters and furniture.
// A thin corridor stays open along y 240-280 so the kitchen pocket behind the
// teal couch (fridge, cabinets) is reachable from the left side of the room.
export const BLOCKED: { x: number; y: number; w: number; h: number }[] = [
  // Back wall, kitchen counters and TVs across the top.
  { x: 0, y: 0, w: 2560, h: 240 },
  // Desk corner, top left.
  { x: 0, y: 240, w: 230, h: 320 },
  // Wall divider and the green armchair beside it.
  { x: 1640, y: 240, w: 50, h: 260 },
  { x: 1530, y: 240, w: 110, h: 160 },
  // Teal couch: vertical arm, then the seat row along the bottom.
  { x: 690, y: 280, w: 220, h: 400 },
  { x: 910, y: 480, w: 300, h: 170 },
  // Coffee table and rug ottomans.
  { x: 1090, y: 300, w: 280, h: 230 },
  // Long table with the green chairs.
  { x: 790, y: 600, w: 900, h: 110 },
  // Big work table, right side.
  { x: 1890, y: 320, w: 500, h: 310 },
  // Whiteboard.
  { x: 460, y: 580, w: 210, h: 230 },
  // Red couch, side table and armchairs in the lounge.
  { x: 0, y: 700, w: 250, h: 440 },
  { x: 350, y: 750, w: 140, h: 180 },
  { x: 470, y: 820, w: 170, h: 330 },
  // Pods and the booth seating along the bottom.
  { x: 680, y: 1090, w: 470, h: 350 },
  { x: 1150, y: 1180, w: 720, h: 260 },
  { x: 2010, y: 1090, w: 470, h: 350 },
  { x: 2480, y: 1090, w: 80, h: 350 },
];

export function isBlocked(x: number, y: number): boolean {
  if (x < 20 || x > WORLD.width - 20 || y < 0 || y > WORLD.height - 16) return true;
  if (
    NPCS.some((n) => Math.abs(x - n.at.x) < 70 && y > n.at.y - 50 && y < n.at.y + 20)
  ) {
    return true;
  }
  return BLOCKED.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
}

export type Hotspot =
  | { kind: "interactable"; target: Interactable; dist: number }
  | { kind: "npc"; target: Npc; dist: number };

// What a CLICK at a world point hits: the interactable's visible art or an
// NPC's body. More generous than proximity because the player clicks the
// drawing, not the walk-up point.
export function hotspotAtPoint(x: number, y: number): Hotspot | null {
  const pad = 14;
  for (const target of INTERACTABLES) {
    const r = target.rect;
    if (x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) {
      return { kind: "interactable", target, dist: 0 };
    }
  }
  for (const target of NPCS) {
    // The box extends above the head so a quest marker click counts too.
    if (Math.abs(x - target.at.x) <= 80 && y >= target.at.y - target.height - 80 && y <= target.at.y + 24) {
      return { kind: "npc", target, dist: 0 };
    }
  }
  return null;
}

// The closest thing within reach of the avatar's feet, if any.
export function nearestHotspot(x: number, y: number): Hotspot | null {
  let best: Hotspot | null = null;
  const consider = (spot: Hotspot) => {
    if (spot.dist <= INTERACT_RADIUS && (!best || spot.dist < best.dist)) best = spot;
  };
  for (const target of INTERACTABLES)
    consider({ kind: "interactable", target, dist: Math.hypot(x - target.at.x, y - target.at.y) });
  for (const target of NPCS)
    consider({ kind: "npc", target, dist: Math.hypot(x - target.at.x, y - target.at.y) });
  return best;
}
