// Single source of truth for merge-variable `{{token}}` handling shared by
// every template surface (hiring/education emails via app/lib/email.ts +
// app/hiring/lib/email-variables.ts, and signing documents via
// app/lib/signing-variables.ts). Stays dependency-free so both the client
// editors and the server can import it.
//
// Each surface still owns its context-specific rules (which slot fills which
// vars, the DB-backed resolvers) — this module owns the vocabulary, the
// placeholder grammar, extraction, and interpolation so those don't drift.

export type TemplateContext = "email" | "signing" | "notification";

export interface TemplateVariableDef {
  description: string;
  contexts: readonly TemplateContext[];
}

// The full vocabulary. `contexts` records where each token is offered; a token
// can belong to more than one surface if it ever needs to.
export const TEMPLATE_VARIABLES_REGISTRY = {
  // ── Email (hiring + education) ──────────────────────────────────────────
  firstName: {
    description: "The recipient's first name.",
    contexts: ["email", "notification"],
  },
  domain: {
    description: "The DALI domain the application is for (e.g. Engineering).",
    contexts: ["email"],
  },
  time: { description: "Interview start time, formatted in Eastern Time.", contexts: ["email"] },
  location: { description: "Interview location (Pod or online).", contexts: ["email"] },
  meetingUrl: { description: "Zoom join URL for online interviews.", contexts: ["email"] },
  originalCloseDate: {
    description: "The cycle's original close date (pre-extension), formatted in Eastern Time.",
    contexts: ["email"],
  },
  newCloseDate: {
    description: "The cycle's new close date (post-extension), formatted in Eastern Time.",
    contexts: ["email"],
  },
  slackUrl: {
    description: "Link to the DALI Slack workspace.",
    contexts: ["email"],
  },

  // ── Notifications ───────────────────────────────────────────────────────
  // Deliberately generic and few. 24 of the 44 notify() call sites interpolate
  // some variant of "the title of the thing" — a meeting, a task, a document, a
  // course, a form, a project — so one token serves them all rather than twenty
  // near-duplicates nobody could keep straight.
  //
  // Call sites pass these ALREADY FORMATTED. Timezone is the reason: several
  // notifications render a time in the *recipient's* own zone, which the sender
  // knows and a template cannot. So the boundary is that the call site owns the
  // data and how it reads, and the template owns the words and their order.
  itemTitle: {
    description:
      "What the notification is about — the meeting, task, document, course, form or project, by name.",
    contexts: ["notification"],
  },
  itemDetail: {
    description:
      "The supporting line: a comment preview, a due date, a time and place. Empty when there isn't one.",
    contexts: ["notification"],
  },
  contextName: {
    description:
      "What the item belongs to — its project, course, cycle or domain. Empty when it stands alone.",
    contexts: ["notification"],
  },
  personName: {
    description: "The person who caused the notification, when there is one.",
    contexts: ["notification"],
  },
  when: {
    description: "A date or time, already written out in the recipient's own timezone.",
    contexts: ["notification"],
  },
  statusLabel: {
    description:
      "A status, level or state, already in its display form (for example In Review, or P2).",
    contexts: ["notification"],
  },
  count: {
    description: "A number the copy refers to, such as how many comments or tasks.",
    contexts: ["notification"],
  },

  // ── Signing documents ───────────────────────────────────────────────────
  term: {
    description:
      "The term the agreement is issued for, e.g. 26F. For per-term agreements this is the term you issue it from (often an upcoming one, sent before it starts); otherwise the current term.",
    contexts: ["signing"],
  },
  upcomingTerm: {
    description: "The term after the one the agreement is issued for, e.g. 27W.",
    contexts: ["signing"],
  },
  today: { description: "The date the document is signed (Eastern Time).", contexts: ["signing"] },
  memberName: { description: "The signer's full name.", contexts: ["signing"] },
  supervisorName: { description: "The DALI staff supervisor's name.", contexts: ["signing"] },
  menteeName: {
    description:
      "The mentee's full name. On a mentee's copy this is the mentee; on a mentor's copy it's the mentee(s) they mentor this term.",
    contexts: ["signing"],
  },
} as const satisfies Record<string, TemplateVariableDef>;

export type TemplateVariableName = keyof typeof TEMPLATE_VARIABLES_REGISTRY;

export function variablesForContext(ctx: TemplateContext): TemplateVariableName[] {
  return (Object.keys(TEMPLATE_VARIABLES_REGISTRY) as TemplateVariableName[]).filter((k) =>
    (TEMPLATE_VARIABLES_REGISTRY[k].contexts as readonly TemplateContext[]).includes(ctx),
  );
}

// The placeholder grammar every surface shares: `{{name}}` with no whitespace,
// ascii-letter-led identifier. Whitespace variants like `{{ firstName }}` are
// intentionally NOT matched — the interpolator can't substitute them either, so
// treating them as known would hide a real bug from the lint surface.
export const PLACEHOLDER_RE = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;

export function extractPlaceholders(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.push(m[1]);
  return out;
}

// Replace every {{token}} present in `vars`, leaving unknown tokens as literal
// text (so a typo like {{firstname}} survives to be flagged by the lint, and
// nothing is silently blanked). Function-form replacement so $-sequences in the
// substituted values aren't treated as regex backrefs.
export function interpolateVars(text: string, vars: Record<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

// Soft lint primitive: the tokens in `text` that aren't in `known`.
export function findUnknownPlaceholders(text: string, known: Iterable<string>): string[] {
  const knownSet = new Set(known);
  const unknown = new Set<string>();
  for (const tok of extractPlaceholders(text)) if (!knownSet.has(tok)) unknown.add(tok);
  return [...unknown];
}
