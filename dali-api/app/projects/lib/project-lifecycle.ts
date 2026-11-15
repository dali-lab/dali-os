export const PROJECT_STATUSES = ["Active", "Paused", "Archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
