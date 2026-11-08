export type BounceState = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type Box = { width: number; height: number };

/** Pixels per second a bouncer travels; each extra bouncer runs a touch faster
 *  so two avatars never stay in lockstep. */
export const BASE_SPEED = 110;

const GOLDEN = 0.618033988749895;

const fract = (n: number) => n - Math.floor(n);

/** Deterministic starting position and heading for bouncer `index`, spread
 *  around the container by golden-ratio hashing so stacked birthdays fan out. */
export function seedBounce(index: number, bounds: Box, size: Box): BounceState {
  const maxX = Math.max(0, bounds.width - size.width);
  const maxY = Math.max(0, bounds.height - size.height);
  const angle = fract(index * GOLDEN + 0.17) * 2 * Math.PI;
  const speed = BASE_SPEED * (1 + index * 0.12);
  return {
    x: fract(index * GOLDEN + 0.31) * maxX,
    y: fract(index * GOLDEN * 2 + 0.57) * maxY,
    vx: Math.cos(angle) * speed || speed,
    vy: Math.sin(angle) * speed || speed,
  };
}

/** One animation step: move by velocity, reflect off the container edges. */
export function advanceBounce(state: BounceState, dtMs: number, bounds: Box, size: Box): BounceState {
  const maxX = Math.max(0, bounds.width - size.width);
  const maxY = Math.max(0, bounds.height - size.height);
  const dt = dtMs / 1000;

  let x = state.x + state.vx * dt;
  let y = state.y + state.vy * dt;
  let { vx, vy } = state;

  if (x < 0) {
    x = -x;
    vx = Math.abs(vx);
  } else if (x > maxX) {
    x = Math.max(0, maxX - (x - maxX));
    vx = -Math.abs(vx);
  }
  if (y < 0) {
    y = -y;
    vy = Math.abs(vy);
  } else if (y > maxY) {
    y = Math.max(0, maxY - (y - maxY));
    vy = -Math.abs(vy);
  }

  return { x, y, vx, vy };
}
