// The runner behind every error screen: a pure state machine so the rules can
// be tested without a canvas. Distances are in world pixels on a fixed-size
// stage; the component scales the drawing to the element.

export const STAGE = { width: 600, height: 150 } as const;
export const GROUND_Y = 130;
export const RUNNER = { x: 40, width: 24, height: 30 } as const;
export const GRAVITY = 1800;
export const JUMP_VELOCITY = 560;
export const START_SPEED = 260;
export const MAX_SPEED = 520;
export const SPEED_GAIN_PER_SECOND = 6;

export type Obstacle = { x: number; width: number; height: number };

export type GameState = {
  status: "ready" | "running" | "over";
  runnerY: number;
  velocityY: number;
  speed: number;
  obstacles: Obstacle[];
  score: number;
  distanceToNextSpawn: number;
  elapsed: number;
};

export function createGame(): GameState {
  return {
    status: "ready",
    runnerY: 0,
    velocityY: 0,
    speed: START_SPEED,
    obstacles: [],
    score: 0,
    distanceToNextSpawn: 320,
    elapsed: 0,
  };
}

/** Space, up arrow, or a tap: starts a ready game, jumps a grounded runner,
 *  restarts a finished one. */
export function press(state: GameState): GameState {
  if (state.status === "ready") return { ...state, status: "running" };
  if (state.status === "over") return { ...createGame(), status: "running" };
  if (state.runnerY > 0) return state;
  return { ...state, velocityY: JUMP_VELOCITY };
}

export function runnerBox(state: GameState) {
  return {
    left: RUNNER.x + 3,
    right: RUNNER.x + RUNNER.width - 3,
    top: GROUND_Y - RUNNER.height - state.runnerY + 3,
    bottom: GROUND_Y - state.runnerY,
  };
}

export function obstacleBox(o: Obstacle) {
  return { left: o.x, right: o.x + o.width, top: GROUND_Y - o.height, bottom: GROUND_Y };
}

export function collides(state: GameState): boolean {
  const r = runnerBox(state);
  return state.obstacles.some((o) => {
    const b = obstacleBox(o);
    return r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
  });
}

/** Advance the world by `dt` seconds. `random` picks obstacle shapes and
 *  gaps; pass a stub for a deterministic run. */
export function step(state: GameState, dt: number, random: () => number = Math.random): GameState {
  if (state.status !== "running") return state;
  const elapsed = state.elapsed + dt;
  const speed = Math.min(MAX_SPEED, state.speed + SPEED_GAIN_PER_SECOND * dt);
  const travelled = speed * dt;

  let velocityY = state.velocityY - GRAVITY * dt;
  let runnerY = state.runnerY + velocityY * dt;
  if (runnerY <= 0) {
    runnerY = 0;
    velocityY = 0;
  }

  let obstacles = state.obstacles
    .map((o) => ({ ...o, x: o.x - travelled }))
    .filter((o) => o.x + o.width > 0);
  let distanceToNextSpawn = state.distanceToNextSpawn - travelled;
  if (distanceToNextSpawn <= 0) {
    const tall = random() < 0.35;
    const wide = random() < 0.3;
    obstacles = [
      ...obstacles,
      { x: STAGE.width, width: wide ? 34 : 16, height: tall ? 38 : 26 },
    ];
    distanceToNextSpawn = 240 + random() * 320;
  }

  const next: GameState = {
    status: "running",
    runnerY,
    velocityY,
    speed,
    obstacles,
    score: Math.floor(elapsed * 10),
    distanceToNextSpawn,
    elapsed,
  };
  return collides(next) ? { ...next, status: "over" } : next;
}
