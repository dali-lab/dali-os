import { useEffect } from "react";

/**
 * Mirror the `os-shell` class onto <html> while the dali.os design is on.
 *
 * The palette is applied by remapping the semantic tokens on `.os-shell` (see
 * app.css), and custom properties reach an element by inheritance — so anything
 * rendered through a portal into `document.body` (hover cards, dialogs, toasts,
 * the command palette) sits *outside* the shell div and would resolve
 * `bg-card` / `text-foreground` against the app's own light-or-dark palette
 * instead. Putting the class at the root puts every portal back inside it.
 *
 * Runs post-mount, which is fine: the shell div carries the class itself for
 * the first paint, and portal content only ever appears after an interaction.
 */
export function useOsShellRoot(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const el = document.documentElement;
    el.classList.add("os-shell");
    return () => el.classList.remove("os-shell");
  }, [enabled]);
}
