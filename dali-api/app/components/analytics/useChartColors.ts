import { useMemo } from "react";

export function useChartColors() {
  return useMemo(() => {
    const s = getComputedStyle(document.documentElement);
    const get = (name: string) => s.getPropertyValue(`--color-${name}`).trim();
    return {
      teal: get("accent-teal"),
      coral: get("accent-coral"),
      coralLight: get("accent-coral-light"),
      green: get("accent-green"),
      pink: get("accent-pink"),
      yellow: get("accent-yellow"),
      border: get("border"),
      muted: get("muted-foreground"),
    };
  }, []);
}
