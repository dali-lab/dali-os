export type PaperworkStatus = "todo" | "open" | "done";

export type PaperworkAction = { label: string; href: string };

export type WaitingItem = {
  id: string;
  kind: "expense" | "signature";
  title: string;
  detail: string;
  action: PaperworkAction;
};

export type TermRow = {
  id: string;
  kind: "form" | "classes" | "application";
  title: string;
  detail: string;
  status: PaperworkStatus;
  action: PaperworkAction;
};

export type AnytimeTile = {
  id: "expense" | "cards" | "refer" | "feedback" | "certificates" | "signed";
  title: string;
  detail: string;
  href: string;
};

export type SetupItem = {
  id: "wallet" | "graduation-email" | "onboarding" | "desktop";
  title: string;
  detail: string;
  done: boolean;
  action: PaperworkAction;
};

export type Paperwork = {
  termLabel: string | null;
  waiting: WaitingItem[];
  term: TermRow[];
  anytime: AnytimeTile[];
  setup: SetupItem[];
};

export type PaperworkInput = {
  termLabel: string | null;
  returnedExpenses: { id: string; merchant: string | null; totalCents: number | null; decisionNote: string | null }[];
  unpaidExpenseCount: number;
  expensesEnabled: boolean;
  fileableCards: { nickname: string; last4: string }[];
  outstandingSignatures: { bindingId: string; documentName: string }[];
  signedCount: number;
  staffingForms: { slot: string; formName: string; fillLink: string; submitted: boolean; submittedAt: string | null }[];
  classCount: number | null;
  applications: { id: string; title: string; body: string | null; link: string | null; dueAt: string | null }[];
  referEnabled: boolean;
  referralCount: number;
  feedbackEnabled: boolean;
  certificateCount: number;
  wallet: { done: boolean } | null;
  graduationEmail: { done: boolean } | null;
  onboarding: { done: boolean } | null;
  desktop: { done: boolean };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function graduatingClassYear(now: Date): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export function isDartmouthAddress(email: string | null): boolean {
  return !!email && /@(alum\.)?dartmouth\.edu$/i.test(email.trim());
}

function waitingItems(input: PaperworkInput): WaitingItem[] {
  const expenses: WaitingItem[] = input.returnedExpenses.map((e) => ({
    id: `expense-${e.id}`,
    kind: "expense",
    title: [e.merchant ?? "Expense", e.totalCents != null ? dollars(e.totalCents) : null].filter(Boolean).join(" · "),
    detail: e.decisionNote ? `Sent back. ${e.decisionNote}` : "Sent back for changes.",
    action: { label: "Open expense", href: `/expenses?expense=${e.id}` },
  }));
  const signatures: WaitingItem[] = input.outstandingSignatures.map((s) => ({
    id: `sign-${s.bindingId}`,
    kind: "signature",
    title: s.documentName,
    detail: "Waiting on your signature.",
    action: { label: "Review and sign", href: `/sign/${s.bindingId}` },
  }));
  return [...expenses, ...signatures];
}

function termRows(input: PaperworkInput): TermRow[] {
  const forms: TermRow[] = input.staffingForms.map((f) => ({
    id: `form-${f.slot}`,
    kind: "form",
    title: f.formName,
    detail: f.submitted && f.submittedAt ? `Sent ${shortDate(f.submittedAt)}` : "Not sent yet",
    status: f.submitted ? "done" : "todo",
    action: { label: f.submitted ? "View" : "Open form", href: f.fillLink },
  }));
  const classes: TermRow[] =
    input.classCount === null
      ? []
      : [
          {
            id: "classes",
            kind: "classes",
            title: "Classes",
            detail: input.classCount > 0 ? plural(input.classCount, "class added", "classes added") : "None added yet",
            status: input.classCount > 0 ? "done" : "todo",
            action: { label: input.classCount > 0 ? "Edit" : "Add classes", href: "/calendar?settings=classes" },
          },
        ];
  const applications: TermRow[] = input.applications
    .filter((a) => a.link)
    .map((a) => ({
      id: `apply-${a.id}`,
      kind: "application",
      title: a.title,
      detail: a.dueAt ? `Due ${shortDate(a.dueAt)}` : (a.body ?? "Open now"),
      status: "open",
      action: { label: "Apply", href: a.link! },
    }));
  return [...forms, ...classes, ...applications];
}

function anytimeTiles(input: PaperworkInput): AnytimeTile[] {
  const tiles: AnytimeTile[] = [];
  if (input.expensesEnabled) {
    tiles.push({
      id: "expense",
      title: "File an expense",
      detail: input.unpaidExpenseCount > 0 ? `${input.unpaidExpenseCount} not paid back yet` : "Receipts for lab purchases",
      href: "/expenses",
    });
    if (input.fileableCards.length > 0) {
      tiles.push({
        id: "cards",
        title: "Staff cards you can use",
        detail: input.fileableCards.map((c) => `${c.nickname} ··${c.last4}`).join(", "),
        href: "/expenses",
      });
    }
  }
  if (input.referEnabled) {
    tiles.push({
      id: "refer",
      title: "Refer a partner",
      detail: input.referralCount > 0 ? `${input.referralCount} sent` : "Leads for new partner projects",
      href: "/refer",
    });
  }
  if (input.feedbackEnabled) {
    tiles.push({ id: "feedback", title: "Send feedback", detail: "Bugs and suggestions for DALI OS", href: "/feedback" });
  }
  if (input.certificateCount > 0) {
    tiles.push({ id: "certificates", title: "Your certificates", detail: `${input.certificateCount} earned`, href: "/education" });
  }
  if (input.signedCount > 0) {
    tiles.push({ id: "signed", title: "Signed documents", detail: `${input.signedCount} signed`, href: "/profile" });
  }
  return tiles;
}

function setupItems(input: PaperworkInput): SetupItem[] {
  const items: SetupItem[] = [];
  if (input.wallet) {
    items.push({
      id: "wallet",
      title: "Lab pass in your wallet",
      detail: "For checking in to meetings",
      done: input.wallet.done,
      action: { label: "Add", href: "/settings/general" },
    });
  }
  if (input.graduationEmail) {
    items.push({
      id: "graduation-email",
      title: "Email for after you graduate",
      detail: "Where your alumni invite is sent",
      done: input.graduationEmail.done,
      action: { label: "Add", href: "/settings/security#contact-email" },
    });
  }
  if (input.onboarding) {
    items.push({
      id: "onboarding",
      title: "Onboarding profile",
      detail: "Your details for the lab directory",
      done: input.onboarding.done,
      action: { label: "Finish", href: "/onboarding" },
    });
  }
  items.push({
    id: "desktop",
    title: "Desktop app",
    detail: "DALI OS for macOS, Windows and Linux",
    done: input.desktop.done,
    action: { label: "Download", href: "/download" },
  });
  return items.every((i) => i.done) ? [] : [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
}

export function buildPaperwork(input: PaperworkInput): Paperwork {
  return {
    termLabel: input.termLabel,
    waiting: waitingItems(input),
    term: termRows(input),
    anytime: anytimeTiles(input),
    setup: setupItems(input),
  };
}

export const SEASON_NAMES = { W: "Winter", S: "Spring", X: "Summer", F: "Fall" } as const;

export function termLabel(term: { season: keyof typeof SEASON_NAMES; year: number } | null): string | null {
  return term ? `${SEASON_NAMES[term.season]} ${term.year}` : null;
}
