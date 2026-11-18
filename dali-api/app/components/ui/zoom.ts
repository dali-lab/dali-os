export type ZoomState = { scale: number; x: number; y: number };
export type Point = { x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.5;
export const FIT: ZoomState = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// `at` is measured from the stage center, so the point under the cursor stays put.
export function zoomTo(state: ZoomState, scale: number, at: Point = { x: 0, y: 0 }): ZoomState {
  const next = clampScale(scale);
  if (next === MIN_SCALE) return FIT;
  const ratio = next / state.scale;
  return { scale: next, x: at.x - (at.x - state.x) * ratio, y: at.y - (at.y - state.y) * ratio };
}

export function zoomBy(state: ZoomState, factor: number, at?: Point): ZoomState {
  return zoomTo(state, state.scale * factor, at);
}

export function panBy(state: ZoomState, dx: number, dy: number): ZoomState {
  if (state.scale === MIN_SCALE) return state;
  return { ...state, x: state.x + dx, y: state.y + dy };
}

export function wheelFactor(deltaY: number, pinch: boolean): number {
  return Math.exp(-deltaY * (pinch ? 0.01 : 0.002));
}

export function toggleZoom(state: ZoomState, at?: Point): ZoomState {
  return state.scale > MIN_SCALE ? FIT : zoomTo(state, 2, at);
}
