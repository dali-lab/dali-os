import type { DriveHomeData } from "~/lib/drive-home.server";

export type HomeSectionKey = "upcoming" | "recent";

export const HOME_SECTION_TITLES: Record<HomeSectionKey, string> = {
  upcoming: "Upcoming meetings",
  recent: "Recent",
};

/** The sections Drive Home renders, in order; empty ones are left out. */
export function homeSections(data: DriveHomeData): HomeSectionKey[] {
  const keys: HomeSectionKey[] = ["upcoming", "recent"];
  return keys.filter((key) => data[key].length > 0);
}
