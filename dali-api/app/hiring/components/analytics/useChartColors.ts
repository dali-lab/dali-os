import { useEffect, useState } from "react";

export interface ChartColors {
  teal: string;
  coral: string;
  coralLight: string;
  green: string;
  pink: string;
  yellow: string;
  border: string;
  muted: string;
}

const FALLBACK: ChartColors = {
  teal: "var(--color-accent-teal)",
  coral: "var(--color-accent-coral)",
  coralLight: "var(--color-accent-coral-light)",
  green: "var(--color-accent-green)",
  pink: "var(--color-accent-pink)",
  yellow: "var(--color-accent-yellow)",
  border: "var(--color-border)",
  muted: "var(--color-muted-foreground)",
};

// Read computed CSS variable values from <html>. Returning fallback values when
// `document` is missing keeps the hook safe under SSR; populating real colors
// happens after mount so server and first-client render stay in sync.
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(FALLBACK);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const s = getComputedStyle(document.documentElement);
    const get = (name: string) => s.getPropertyValue(`--color-${name}`).trim();
    setColors({
      teal: get("accent-teal") || FALLBACK.teal,
      coral: get("accent-coral") || FALLBACK.coral,
      coralLight: get("accent-coral-light") || FALLBACK.coralLight,
      green: get("accent-green") || FALLBACK.green,
      pink: get("accent-pink") || FALLBACK.pink,
      yellow: get("accent-yellow") || FALLBACK.yellow,
      border: get("border") || FALLBACK.border,
      muted: get("muted-foreground") || FALLBACK.muted,
    });
  }, []);

  return colors;
}
