import { describe, it, expect } from "vitest";
import {
  GROUND_Y,
  MAX_SPEED,
  STAGE,
  START_SPEED,
  collides,
  createGame,
  press,
  step,
  type GameState,
} from "~/components/dino/dino-engine";

const noSpawn = () => 0.99;
function run(state: GameState, seconds: number, random = noSpawn) {
  let s = state;
  for (let t = 0; t < seconds; t += 1 / 60) s = step(s, 1 / 60, random);
  return s;
}

describe("dino engine", () => {
  it("waits for the first press before anything moves", () => {
    const idle = step(createGame(), 1);
    expect(idle).toEqual(createGame());
    expect(press(createGame()).status).toBe("running");
  });

  it("jumps from the ground, rises, and lands back on it", () => {
    const running = press(createGame());
    const jumped = press(running);
    expect(jumped.velocityY).toBeGreaterThan(0);
    const mid = run(jumped, 0.15);
    expect(mid.runnerY).toBeGreaterThan(0);
    const landed = run(jumped, 1);
    expect(landed.runnerY).toBe(0);
    expect(landed.velocityY).toBe(0);
  });

  it("ignores a press while already in the air", () => {
    const airborne = run(press(press(createGame())), 0.1);
    expect(press(airborne)).toBe(airborne);
  });

  it("spawns obstacles at the right edge and scrolls them left", () => {
    const first = { ...press(createGame()), distanceToNextSpawn: 0 };
    const spawned = step(first, 1 / 60, () => 0.5);
    expect(spawned.obstacles).toHaveLength(1);
    expect(spawned.obstacles[0].x).toBe(STAGE.width);
    const later = run(spawned, 0.5);
    expect(later.obstacles[0].x).toBeLessThan(STAGE.width - 100);
  });

  it("drops obstacles once they leave the stage", () => {
    const s = { ...press(createGame()), obstacles: [{ x: 5, width: 16, height: 26 }] };
    expect(run(s, 0.2).obstacles).toHaveLength(0);
  });

  it("ends the game when the runner hits an obstacle", () => {
    const s = { ...press(createGame()), obstacles: [{ x: 70, width: 16, height: 26 }] };
    expect(collides(s)).toBe(false);
    const after = run(s, 0.3);
    expect(after.status).toBe("over");
    expect(collides(after)).toBe(true);
  });

  it("clears a low obstacle with a well-timed jump", () => {
    let s: GameState = { ...press(createGame()), obstacles: [{ x: 150, width: 16, height: 26 }] };
    s = press(run(s, 0.25));
    s = run(s, 0.8);
    expect(s.status).toBe("running");
    expect(s.obstacles.every((o) => o.x + o.width < 40)).toBe(true);
  });

  it("scores ten points a second and speeds up to a cap", () => {
    const clear = { ...press(createGame()), distanceToNextSpawn: Infinity };
    const s = run(clear, 2);
    expect(s.score).toBe(20);
    expect(s.speed).toBeGreaterThan(START_SPEED);
    const long = run(clear, 60);
    expect(long.status).toBe("running");
    expect(long.speed).toBe(MAX_SPEED);
  });

  it("freezes when over and restarts fresh on the next press", () => {
    const over: GameState = { ...press(createGame()), status: "over", score: 42, obstacles: [{ x: 50, width: 16, height: 26 }] };
    expect(step(over, 1)).toBe(over);
    const restarted = press(over);
    expect(restarted).toEqual({ ...createGame(), status: "running" });
  });

  it("keeps the runner's feet on the ground line", () => {
    const s = press(createGame());
    expect(GROUND_Y - s.runnerY).toBe(GROUND_Y);
  });
});
