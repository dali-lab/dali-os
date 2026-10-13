import { useEffect, useState } from "react";

export const NOTEBOOK_RAIL_COLLAPSED_KEY = "dali:notebook-rail:collapsed";

/** The rail's collapsed flag, remembered per browser. Read in an effect so the
 *  server render and the first client render agree. */
export function useRailCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(NOTEBOOK_RAIL_COLLAPSED_KEY) === "1");
    } catch {}
  }, []);

  function set(next: boolean) {
    setCollapsed(next);
    try {
      if (next) window.localStorage.setItem(NOTEBOOK_RAIL_COLLAPSED_KEY, "1");
      else window.localStorage.removeItem(NOTEBOOK_RAIL_COLLAPSED_KEY);
    } catch {}
  }

  return { collapsed, setCollapsed: set };
}
