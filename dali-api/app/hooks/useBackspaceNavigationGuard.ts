import { useEffect } from "react";
import { isBackspaceNavigation } from "~/lib/shortcuts";

export function useBackspaceNavigationGuard(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBackspaceNavigation(e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
