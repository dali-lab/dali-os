/** The height, in slide units, a text box needs to show all its text. Null when it already fits. */
export function neededHeight(box: { scrollHeight: number; clientHeight: number; offsetWidth: number }, widthUnits: number): number | null {
  if (box.offsetWidth <= 0 || box.scrollHeight <= box.clientHeight + 1) return null;
  return Math.ceil(box.scrollHeight * (widthUnits / box.offsetWidth));
}
