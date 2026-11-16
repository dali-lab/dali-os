import { stringSetCodec, type PersistCodec } from "~/hooks/usePersistedState";
import { DEFAULT_LAYER_VISIBILITY, type LayerVisibility } from "./layers";
import type { TimesheetHoursScope } from "./types";

export const CALENDAR_LAYERS_KEY = "dali:calendar:layers";
export const CALENDAR_HIDDEN_CALS_KEY = "dali:calendar:hiddenCals";
export const CALENDAR_ROLE_COLORS_KEY = "dali:calendar:roleColors";
export const CALENDAR_HOURS_SCOPE_KEY = "dali:calendar:hoursScope";

export const isPlainObject = (v: unknown): v is Record<string, string> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isLayerVisibility = (v: unknown): v is LayerVisibility => typeof v === "object" && v !== null;

export const isHoursScope = (v: unknown): v is TimesheetHoursScope => v === "week" || v === "period";

export const hoursScopeCodec: PersistCodec<TimesheetHoursScope> = {
  parse: (raw) => (raw === "week" ? "week" : "period"),
  serialize: (value) => value,
};

export const layersCodec: PersistCodec<LayerVisibility> = {
  parse: (raw) => ({ ...DEFAULT_LAYER_VISIBILITY, ...(JSON.parse(raw) as Partial<LayerVisibility>) }),
  serialize: (value) => JSON.stringify(value),
};
