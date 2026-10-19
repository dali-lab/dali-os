export const RECORD_TABS = ["overview", "evaluation", "meetings", "details", "sow", "email"] as const;

export type RecordTab = (typeof RECORD_TABS)[number];

// The modal's "view all" links say activity; on the full page that feed is Overview.
export function initialRecordTab(param: string | null): RecordTab {
  if (param === "activity") return "overview";
  return (RECORD_TABS as readonly string[]).includes(param ?? "") ? (param as RecordTab) : "overview";
}
