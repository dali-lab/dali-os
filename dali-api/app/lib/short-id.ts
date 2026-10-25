/** A short random id with a readable prefix, e.g. "slide-k3x9q0aa1b2c", for ids inside JSON documents. */
export function createId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}-${Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("")}`;
}
