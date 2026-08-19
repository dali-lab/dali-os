// Single source of truth for the signing-document config facets — kind, gate
// scope, audience, cadence. The allowlists validate writes (admin create route,
// the agreement Settings editor, and the manage_agreement MCP tool); the option
// arrays drive the matching <Select> menus. Client-safe (no server imports) so
// the same values label the UI and guard the server.

import type {
  SigningDocumentKind,
  SigningGateScope,
  SigningAudience,
  SigningCadence,
} from "~/generated/prisma/enums";

export const KINDS: SigningDocumentKind[] = [
  "General",
  "MemberAgreement",
  "MentorshipAgreement",
  "Confidentiality",
];
export const SCOPES: SigningGateScope[] = ["None", "App", "HiringCycle"];
export const AUDIENCES: SigningAudience[] = [
  "Manual",
  "ActiveMembers",
  "Mentors",
  "HiringParticipants",
];
export const CADENCES: SigningCadence[] = ["Once", "PerTerm", "PerCycle"];

// Select options (value + human label). Assignable to the floating `Select`'s
// `SelectOption[]` prop; kept as plain objects here to avoid a component import.
type ConfigOption = { value: string; label: string };

export const KIND_OPTIONS: ConfigOption[] = [
  { value: "General", label: "General" },
  { value: "MemberAgreement", label: "Membership" },
  { value: "MentorshipAgreement", label: "Mentorship" },
  { value: "Confidentiality", label: "Confidentiality" },
];

export const SCOPE_OPTIONS: ConfigOption[] = [
  { value: "None", label: "Not enforced (surface only)" },
  { value: "App", label: "Hard-gate the app until signed" },
  { value: "HiringCycle", label: "Gate hiring data (confidentiality)" },
];

export const AUDIENCE_OPTIONS: ConfigOption[] = [
  { value: "Manual", label: "Manual (no one auto-required)" },
  { value: "ActiveMembers", label: "Active members" },
  { value: "Mentors", label: "Mentors" },
  { value: "HiringParticipants", label: "Hiring participants" },
];

export const CADENCE_OPTIONS: ConfigOption[] = [
  { value: "Once", label: "One-time (sign once)" },
  { value: "PerTerm", label: "Per term (re-sign each term)" },
  { value: "PerCycle", label: "Per hiring cycle" },
];
