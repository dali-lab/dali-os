export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export const clampZoom = (z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000));

export function zoomIn(z: number): number {
  return ZOOM_PRESETS.find((p) => p > z + 0.001) ?? ZOOM_MAX;
}

export function zoomOut(z: number): number {
  return [...ZOOM_PRESETS].reverse().find((p) => p < z - 0.001) ?? ZOOM_MIN;
}

/** The new zoom for a trackpad pinch, which browsers report as a wheel event with ctrlKey and a small deltaY. */
export function pinchZoom(z: number, deltaY: number): number {
  return clampZoom(z * Math.exp(-deltaY * 0.01));
}

export type ZoomKey = "in" | "out" | "fit";

export function zoomKey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ZoomKey | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+") return "in";
  if (e.key === "-" || e.key === "_") return "out";
  if (e.key === "0") return "fit";
  return null;
}

export const zoomLabel = (z: number): string => `${Math.round(z * 100)}%`;

/** A screen point in slide units, from the box the slide is drawn in. The box is the scaled one, so zoom needs no special case. */
export function clientToUnits(point: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }, stage: { w: number; h: number }) {
  return { x: ((point.x - box.left) / box.width) * stage.w, y: ((point.y - box.top) / box.height) * stage.h };
}
