export type IntentStatusValue = "Returning" | "Off" | "Graduating" | "Leave" | "Unsure";

export const INTENT_STATUSES: IntentStatusValue[] = ["Returning", "Off", "Graduating", "Leave", "Unsure"];

export const INTENT_STATUS_LABELS: Record<IntentStatusValue, string> = {
  Returning: "Returning",
  Off: "Off this term",
  Graduating: "Graduating",
  Leave: "On leave",
  Unsure: "Unsure",
};

export function isIntentStatus(v: unknown): v is IntentStatusValue {
  return typeof v === "string" && (INTENT_STATUSES as string[]).includes(v);
}
