import { flagCodec, usePersistedState } from "~/hooks/usePersistedState";

export const NOTEBOOK_RAIL_COLLAPSED_KEY = "dali:notebook-rail:collapsed";

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

export function useRailCollapsed() {
  const [collapsed, setCollapsed] = usePersistedState(NOTEBOOK_RAIL_COLLAPSED_KEY, false, isBoolean, flagCodec);
  return { collapsed, setCollapsed };
}
