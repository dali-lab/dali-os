/** The slides that present, follow and export show: skipped ones drop out unless that would leave nothing. */
export function presentable<T extends { skipped?: boolean }>(slides: T[]): T[] {
  const shown = slides.filter((s) => !s.skipped);
  return shown.length > 0 ? shown : slides;
}
