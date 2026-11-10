import type { Question } from "~/types";
import type { ReferenceSourceKey } from "./reference-sources.shared";

export type FillerKind = "member" | "partner" | "other" | "anonymous";

const FILLER_NOUNS: Record<FillerKind, string> = {
  member: "lab members",
  partner: "partners",
  other: "other signed-in people",
  anonymous: "people who aren't signed in",
};

type PrefillFieldDef = {
  label: string;
  fillers: readonly FillerKind[];
  types: readonly Question["type"][];
  referenceSource?: ReferenceSourceKey;
};

const SIGNED_IN: readonly FillerKind[] = ["member", "partner", "other"];

export const PREFILL_FIELDS = {
  "me.name": { label: "Their name", fillers: SIGNED_IN, types: ["text"] },
  "me.email": { label: "Their email", fillers: SIGNED_IN, types: ["email", "text"] },
  "partner.title": { label: "Their job title", fillers: ["partner"], types: ["text"] },
  "partner.phone": { label: "Their phone", fillers: ["partner"], types: ["text"] },
  "partnerOrg.name": { label: "Their organization's name", fillers: ["partner"], types: ["text"] },
  "partnerOrg.legalEntityName": {
    label: "Their organization's legal name",
    fillers: ["partner"],
    types: ["text"],
  },
  "partnerOrg.address": {
    label: "Their organization's address",
    fillers: ["partner"],
    types: ["text", "textarea"],
  },
  "partnerOrg.website": { label: "Their organization's website", fillers: ["partner"], types: ["text"] },
  "partnerOrg.project": {
    label: "Their project, when they have just one",
    fillers: ["partner"],
    types: ["reference"],
    referenceSource: "projects:my-organization",
  },
} as const satisfies Record<string, PrefillFieldDef>;

export type PrefillFieldKey = keyof typeof PREFILL_FIELDS;

export function isPrefillFieldKey(key: unknown): key is PrefillFieldKey {
  return typeof key === "string" && Object.hasOwn(PREFILL_FIELDS, key);
}

export function prefillFieldFits(key: PrefillFieldKey, question: Pick<Question, "type" | "data">): boolean {
  const def: PrefillFieldDef = PREFILL_FIELDS[key];
  if (!def.types.includes(question.type)) return false;
  return !def.referenceSource || def.referenceSource === question.data.referenceSource;
}

export function prefillFieldsFor(question: Pick<Question, "type" | "data">): PrefillFieldKey[] {
  return (Object.keys(PREFILL_FIELDS) as PrefillFieldKey[]).filter((k) => prefillFieldFits(k, question));
}

export function fillersForSharing(linkAccess: string, shareKinds: readonly FillerKind[]): FillerKind[] {
  const base: FillerKind[] =
    linkAccess === "Public"
      ? ["member", "partner", "other", "anonymous"]
      : linkAccess === "SignedIn"
        ? ["member", "partner", "other"]
        : linkAccess === "LabMembers"
          ? ["member"]
          : linkAccess === "Partners"
            ? ["partner"]
            : shareKinds.length
              ? []
              : ["member"];
  return [...new Set([...base, ...shareKinds])];
}

export type PrefillReach = { reach: "all" } | { reach: "some"; blankFor: string } | { reach: "none" };

export function prefillReach(key: PrefillFieldKey, fillers: readonly FillerKind[]): PrefillReach {
  const covered: readonly FillerKind[] = PREFILL_FIELDS[key].fillers;
  const missed = fillers.filter((f) => !covered.includes(f));
  if (missed.length === 0) return { reach: "all" };
  if (missed.length === fillers.length) return { reach: "none" };
  return { reach: "some", blankFor: joinNouns(missed.map((f) => FILLER_NOUNS[f])) };
}

function joinNouns(nouns: string[]): string {
  if (nouns.length <= 1) return nouns.join("");
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function prefillSummary(key: PrefillFieldKey): string {
  return `Fills in ${lowerFirst(PREFILL_FIELDS[key].label)}`;
}

export function prefillHint(key: PrefillFieldKey): string {
  return `Fills in for ${fillersNoun(PREFILL_FIELDS[key].fillers)}: ${lowerFirst(PREFILL_FIELDS[key].label)}.`;
}

export function fillersNoun(fillers: readonly FillerKind[]): string {
  return joinNouns(fillers.map((f) => FILLER_NOUNS[f]));
}
