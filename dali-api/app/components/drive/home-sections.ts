import type { DriveHomeData } from "~/lib/drive-home.server";

export type HomeSectionKey = "upcoming" | "recent" | "starred";

export const HOME_SECTION_TITLES: Record<HomeSectionKey, string> = {
  upcoming: "Upcoming meetings",
  recent: "Recent",
  starred: "Starred",
};

/** The sections Drive Home renders, in order; empty ones are left out. */
export function homeSections(data: DriveHomeData): HomeSectionKey[] {
  const keys: HomeSectionKey[] = ["upcoming", "recent", "starred"];
  return keys.filter((key) => data[key].length > 0);
}
