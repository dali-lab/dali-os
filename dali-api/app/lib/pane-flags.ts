type PaneFlag = boolean | ((data: unknown) => boolean);

// A route sets these as a boolean, or as a function of its loader data when
// only some viewers get the layout (the alumni Home map).
export function paneFlag(
  match: { handle?: unknown; data?: unknown },
  key: "fitViewport" | "bleedPane",
): boolean {
  const flag = (match.handle as Partial<Record<typeof key, PaneFlag>> | undefined)?.[key];
  return typeof flag === "function" ? flag(match.data) : Boolean(flag);
}
