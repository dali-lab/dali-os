// The lab runs a handful of parallel "servers" (instances). Everyone on the
// same server sees each other walk around. Client-safe.

export const LAB_SERVERS = [
  { id: "lab-1", label: "Lab 1" },
  { id: "lab-2", label: "Lab 2" },
  { id: "lab-3", label: "Lab 3" },
  { id: "lab-4", label: "Lab 4" },
] as const;

export type LabServerId = (typeof LAB_SERVERS)[number]["id"];

export const SERVER_CAPACITY = 15;

export function isLabServerId(value: unknown): value is LabServerId {
  return LAB_SERVERS.some((s) => s.id === value);
}

export type ServerStatus = "open" | "busy" | "full";

// Green = pretty empty, yellow = slightly crowded, red = full.
export function serverStatus(count: number): ServerStatus {
  if (count >= SERVER_CAPACITY) return "full";
  if (count >= SERVER_CAPACITY * 0.5) return "busy";
  return "open";
}
