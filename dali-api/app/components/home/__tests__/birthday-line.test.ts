import { describe, expect, it } from "vitest";
import { CONFETTI_LIFE_S, claimConfetti, confettiKey, seedConfetti, separatorBefore, stepConfetti } from "../birthday-line";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
  };
}

describe("separatorBefore", () => {
  const join = (names: string[]) => names.map((n, i) => separatorBefore(i, names.length) + n).join("");

  it("joins one, two and more names in plain English", () => {
    expect(join(["Ada"])).toBe("Ada");
    expect(join(["Ada", "Bo"])).toBe("Ada and Bo");
    expect(join(["Ada", "Bo", "Cy"])).toBe("Ada, Bo and Cy");
  });
});

describe("claimConfetti", () => {
  const day = new Date(2026, 10, 16, 9);

  it("bursts the first time Home opens on a day, then not again", () => {
    const storage = memoryStorage();
    expect(claimConfetti(storage, day)).toBe(true);
    expect(claimConfetti(storage, new Date(2026, 10, 16, 18))).toBe(false);
  });

  it("bursts again the next day", () => {
    const storage = memoryStorage();
    claimConfetti(storage, day);
    expect(claimConfetti(storage, new Date(2026, 10, 17, 8))).toBe(true);
  });

  it("keys on the viewer's local date", () => {
    expect(confettiKey(new Date(2026, 0, 5, 23, 30))).toBe("dali:birthday-confetti:2026-01-05");
  });

  it("stays still without storage or when storage throws", () => {
    expect(claimConfetti(null, day)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(claimConfetti(broken, day)).toBe(false);
  });
});

describe("confetti", () => {
  it("starts every piece at the origin, thrown upward", () => {
    const bits = seedConfetti({ x: 40, y: 80 }, 1, 30);
    expect(bits).toHaveLength(30);
    for (const b of bits) {
      expect([b.x, b.y]).toEqual([40, 80]);
      expect(b.vy).toBeLessThan(0);
    }
  });

  it("falls under gravity and runs out after its lifetime", () => {
    const bits = seedConfetti({ x: 0, y: 0 }, 1, 10, () => 0.5);
    const vy = bits[0].vy;
    expect(stepConfetti(bits, 0.1, 1)).toBe(10);
    expect(bits[0].vy).toBeGreaterThan(vy);
    let alive = 10;
    for (let t = 0; t < CONFETTI_LIFE_S + 0.2; t += 0.05) alive = stepConfetti(bits, 0.05, 1);
    expect(alive).toBe(0);
  });
});
