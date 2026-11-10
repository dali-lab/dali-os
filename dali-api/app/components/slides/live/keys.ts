export type NavAction = "next" | "prev" | "first" | "last" | "exit";

const KEYS: Record<string, NavAction> = {
  ArrowRight: "next",
  ArrowDown: "next",
  " ": "next",
  PageDown: "next",
  ArrowLeft: "prev",
  ArrowUp: "prev",
  PageUp: "prev",
  Home: "first",
  End: "last",
  Escape: "exit",
};

export const navActionFor = (key: string): NavAction | null => KEYS[key] ?? null;

export function nextIndex(action: NavAction, index: number, total: number): number {
  if (action === "next") return Math.min(index + 1, total - 1);
  if (action === "prev") return Math.max(index - 1, 0);
  if (action === "first") return 0;
  if (action === "last") return Math.max(total - 1, 0);
  return index;
}
