// Single source of truth for the signing-document config facets — kind, gate
// scope, audience, cadence. The allowlists validate writes (admin create route,
// the agreement Settings editor, and the manage_agreement MCP tool); the option
// arrays drive the matching <Select> menus. Client-safe (no server imports) so
// the same values label the UI and guard the server.

import type {
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";

export const SCOPES: SigningGateScope[] = ["None", "App", "HiringCycle"];
export const AUDIENCES: SigningAudience[] = [
  "Manual",
  "NewMembers",
  "Members",
  "Mentors",
  "HiringParticipants",
  "Group",
];
export const CADENCES: SigningCadence[] = ["Once", "PerTerm", "PerCycle"];

// Select options (value + human label). Assignable to the floating `Select`'s
// `SelectOption[]` prop; kept as plain objects here to avoid a component import.
type ConfigOption = { value: string; label: string };

export const SCOPE_OPTIONS: ConfigOption[] = [
  { value: "None", label: "Not enforced (surface only)" },
  { value: "App", label: "Hard-gate the app until signed" },
  { value: "HiringCycle", label: "Gate hiring data (confidentiality)" },
];

export const AUDIENCE_OPTIONS: ConfigOption[] = [
  { value: "Manual", label: "Manual (no one auto-required)" },
  { value: "NewMembers", label: "New members (first term staffed)" },
  { value: "Members", label: "Returning members (staffed this term)" },
  { value: "Mentors", label: "Mentors (staffed this term)" },
  { value: "HiringParticipants", label: "Hiring participants (in a cycle)" },
  { value: "Group", label: "Active this term (staffed)" },
];

export const CADENCE_OPTIONS: ConfigOption[] = [
  { value: "Once", label: "One-time (sign once)" },
  { value: "PerTerm", label: "Per term (re-sign each term)" },
  { value: "PerCycle", label: "Per hiring cycle" },
];

// Compact labels for the config pills (the dropdown items use the fuller
// *_OPTIONS labels above).
export const SCOPE_SHORT: Record<string, string> = {
  None: "Not enforced",
  App: "App gate",
  HiringCycle: "Hiring gate",
};
export const AUDIENCE_SHORT: Record<string, string> = {
  Manual: "Manual",
  NewMembers: "New members",
  Members: "Returning",
  Mentors: "Mentors",
  HiringParticipants: "Hiring",
  Group: "Active this term",
};
export const CADENCE_SHORT: Record<string, string> = {
  Once: "Once",
  PerTerm: "Per term",
  PerCycle: "Per cycle",
};
