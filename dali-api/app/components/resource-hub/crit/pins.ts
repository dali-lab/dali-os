/** Where a click landed on an image, as fractions (0..1) of its rendered width and height, so a pin stays put when the image resizes. */
export function pointToFraction(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }) {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

/** Whether a keypress should be treated as the comment shortcut: plain C, and not while typing. */
export function isCommentShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null }) {
  if (e.key.toLowerCase() !== "c" || e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  if (!t) return true;
  const tag = t.tagName;
  return !(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable);
}
