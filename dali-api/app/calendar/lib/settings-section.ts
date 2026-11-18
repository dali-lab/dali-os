export type SettingsSectionId = "calendars" | "classes" | "hours";

export function settingsSectionParam(raw: string | null): SettingsSectionId | null {
  return raw === "calendars" || raw === "classes" || raw === "hours" ? raw : null;
}
