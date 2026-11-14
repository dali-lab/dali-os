export type Confetto = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  turn: number;
  size: number;
  color: string;
  age: number;
};

export const CONFETTI_COLORS = ["#f2f23a", "#ec4899", "#6366f1", "#f59e0b", "#ffffff", "#4cb3c9"];
export const CONFETTI_LIFE_S = 1.8;
const GRAVITY = 520;
const DRAG = 1.2;

export function separatorBefore(index: number, count: number): string {
  if (index === 0) return "";
  return index === count - 1 ? " and " : ", ";
}

export function confettiKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `dali:birthday-confetti:${y}-${m}-${d}`;
}

export function claimConfetti(storage: Pick<Storage, "getItem" | "setItem"> | null, now: Date): boolean {
  if (!storage) return false;
  const key = confettiKey(now);
  try {
    if (storage.getItem(key)) return false;
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

export function seedConfetti(
  origin: { x: number; y: number },
  scale: number,
  count = 90,
  random: () => number = Math.random,
): Confetto[] {
  return Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (random() - 0.5) * 2.2;
    const speed = (180 + random() * 260) * scale;
    return {
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: random() * Math.PI * 2,
      turn: (random() - 0.5) * 12,
      size: (4 + random() * 4) * scale,
      color: CONFETTI_COLORS[Math.floor(random() * CONFETTI_COLORS.length)],
      age: 0,
    };
  });
}

export function stepConfetti(bits: Confetto[], dt: number, scale: number): number {
  let alive = 0;
  for (const b of bits) {
    b.age += dt;
    b.vy += GRAVITY * scale * dt;
    b.vx *= 1 - DRAG * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.spin += b.turn * dt;
    if (b.age < CONFETTI_LIFE_S) alive++;
  }
  return alive;
}
