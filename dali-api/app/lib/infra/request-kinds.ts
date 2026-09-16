// Single source of truth for infra change-request kinds. The dropdown (project
// hub), the submit validator (api.infra.request), and the display labels (hub +
// fleet console) all derive from this list — add or rename a kind here and every
// surface follows, no migration needed (the column is a free-form String).
//
// Keep the pool small and broad: `details` carries the specifics, so a kind only
// needs to be coarse enough to triage/route on. Client-safe — no server imports.

export type InfraRequestKindOption = {
  value: string;
  label: string;
  /** One-line hint rendered under the option in the picker; keep it short. */
  description?: string;
};

export const INFRA_REQUEST_KINDS: InfraRequestKindOption[] = [
  { value: "provision", label: "Provision a resource", description: "A new database, app, or service" },
  { value: "scale", label: "Scale or resize", description: "More/less compute, storage, or limits" },
  { value: "access", label: "Access or credentials", description: "Secrets, env vars, or permissions" },
  { value: "other", label: "Something else" },
];

export const INFRA_REQUEST_KIND_VALUES = INFRA_REQUEST_KINDS.map((k) => k.value) as [
  string,
  ...string[],
];

// Human label for a stored kind, falling back to a humanized form so legacy or
// unknown values (e.g. the old `provision_database`) still render cleanly.
export function infraRequestKindLabel(value: string): string {
  return INFRA_REQUEST_KINDS.find((k) => k.value === value)?.label ?? value.replace(/_/g, " ");
}
