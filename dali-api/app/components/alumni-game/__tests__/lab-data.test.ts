import { describe, it, expect } from "vitest";
import {
  WORLD,
  SPAWN,
  INTERACT_RADIUS,
  INTERACTABLES,
  NPCS,
  isBlocked,
  nearestHotspot,
  hotspotAtPoint,
} from "../lab-data";

describe("map data", () => {
  it("keeps every hotspot inside the world", () => {
    const points = [
      ...INTERACTABLES.map((i) => i.at),
      ...NPCS.map((n) => n.at),
      SPAWN,
    ];
    for (const p of points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(WORLD.width);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(WORLD.height);
    }
  });

  it("has unique interactable ids", () => {
    const list = INTERACTABLES.map((i) => i.id);
    expect(new Set(list).size).toBe(list.length);
  });

  it("places Lorie on the left shadow and Tim on the right", () => {
    const lorie = NPCS.find((n) => n.id === "lorie")!;
    const tim = NPCS.find((n) => n.id === "tim")!;
    expect(lorie.at.x).toBeLessThan(WORLD.width / 2);
    expect(tim.at.x).toBeGreaterThan(WORLD.width / 2);
  });
});

describe("isBlocked", () => {
  it("lets the avatar spawn and walk the open floor", () => {
    expect(isBlocked(SPAWN.x, SPAWN.y)).toBe(false);
    expect(isBlocked(1800, 900)).toBe(false);
  });

  it("blocks walking through Tim and Lorie", () => {
    for (const npc of NPCS) {
      expect(isBlocked(npc.at.x, npc.at.y)).toBe(true);
      expect(isBlocked(npc.at.x - 50, npc.at.y - 20)).toBe(true);
    }
  });

  it("blocks walls, furniture and out-of-bounds", () => {
    expect(isBlocked(-10, 700)).toBe(true);
    expect(isBlocked(1280, 100)).toBe(true); // back wall
    expect(isBlocked(900, 450)).toBe(true); // teal couch
    expect(isBlocked(2100, 500)).toBe(true); // work table
    expect(isBlocked(900, 1200)).toBe(true); // pod APPA
  });

  it("keeps a walkable approach within reach of every hotspot", () => {
    const reachable = (x: number, y: number) => {
      for (let dy = -INTERACT_RADIUS; dy <= INTERACT_RADIUS; dy += 10) {
        for (let dx = -INTERACT_RADIUS; dx <= INTERACT_RADIUS; dx += 10) {
          if (Math.hypot(dx, dy) > INTERACT_RADIUS) continue;
          if (!isBlocked(x + dx, y + dy)) return true;
        }
      }
      return false;
    };
    for (const spot of [
      ...INTERACTABLES.map((i) => ({ id: i.id, ...i.at })),
      ...NPCS.map((n) => ({ id: n.id, ...n.at })),
    ]) {
      expect(reachable(spot.x, spot.y), `${spot.id} unreachable`).toBe(true);
    }
  });
});

describe("hotspotAtPoint", () => {
  it("hits an interactable anywhere on its art, not just the walk-up point", () => {
    const pizza = INTERACTABLES.find((i) => i.id === "pizza")!;
    const centerX = pizza.rect.x + pizza.rect.w / 2;
    const centerY = pizza.rect.y + pizza.rect.h / 2;
    const spot = hotspotAtPoint(centerX, centerY);
    expect(spot?.kind).toBe("interactable");
    expect(spot && spot.kind === "interactable" ? spot.target.id : null).toBe("pizza");
  });

  it("hits an NPC on the body and on the quest marker above the head", () => {
    const tim = NPCS.find((n) => n.id === "tim")!;
    expect(hotspotAtPoint(tim.at.x, tim.at.y - tim.height / 2)?.kind).toBe("npc");
    expect(hotspotAtPoint(tim.at.x, tim.at.y - tim.height - 60)?.kind).toBe("npc");
  });

  it("misses open floor", () => {
    expect(hotspotAtPoint(1800, 950)).toBeNull();
  });

  it("no longer treats the chairs as hotspots", () => {
    expect(hotspotAtPoint(924, 770)).toBeNull();
    expect(hotspotAtPoint(330, 1290)).toBeNull();
  });
});

describe("nearestHotspot", () => {
  it("finds Tim when standing next to him", () => {
    const tim = NPCS.find((n) => n.id === "tim")!;
    const spot = nearestHotspot(tim.at.x - 80, tim.at.y);
    expect(spot?.kind).toBe("npc");
    expect(spot && spot.kind === "npc" ? spot.target.id : null).toBe("tim");
  });

  it("returns nothing on open floor away from everything", () => {
    expect(nearestHotspot(1800, 950)).toBeNull();
  });

  it("prefers the closest of overlapping hotspots", () => {
    const fridge = INTERACTABLES.find((i) => i.id === "fridge")!;
    const spot = nearestHotspot(fridge.at.x + 5, fridge.at.y + 5);
    expect(spot && spot.kind === "interactable" ? spot.target.id : null).toBe("fridge");
  });
});
