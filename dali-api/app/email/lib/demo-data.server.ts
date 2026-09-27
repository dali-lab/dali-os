// Local-dev demo of the Email tab: /email?demo=1 renders made-up inboxes,
// threads, drafts and comments so the UI can be designed without Google
// OAuth. Only in the Vite dev server (`npm run dev`); builds compile it out.

import { isAiEnabled } from "~/lib/ai.server";
import type { MailMessage } from "~/email/lib/gmail-mailbox.server";
import type { EmailPageData, FeedThread } from "~/email/lib/email.server";

export function isEmailDemo(request: Request): boolean {
  return import.meta.env.DEV && new URL(request.url).searchParams.get("demo") === "1";
}

export function demoEmailAction(intent: string, draftId: string) {
  if (intent === "send") return { ok: true, sent: true };
  if (intent === "saveDraft") return { ok: true, draftId: draftId || "demo-draft-new" };
  return { ok: true };
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;

const ME = "Alex Chen <alex.chen@dali.dartmouth.edu>";

const ACCOUNTS: EmailPageData["accounts"] = [
  { id: "deserto", kind: "Project", address: "deserto@dali.dartmouth.edu", label: "Deserto", projectId: "p-deserto", connected: true, syncError: null, archived: false },
  { id: "bloom", kind: "Project", address: "bloom@dali.dartmouth.edu", label: "Bloom", projectId: "p-bloom", connected: false, syncError: null, archived: false },
  { id: "partners", kind: "Shared", address: "partners@dali.dartmouth.edu", label: "Partnerships", projectId: null, connected: true, syncError: null, archived: false },
  { id: "hiring", kind: "Shared", address: "hiring@dali.dartmouth.edu", label: "Hiring", projectId: null, connected: true, syncError: "Sign-in expired. Reconnect this account.", archived: false },
];

type DemoThread = FeedThread & { messages: MailMessage[] };

function msg(
  id: string,
  m: Partial<MailMessage> & Pick<MailMessage, "from" | "date" | "subject">,
): MailMessage {
  return {
    id,
    to: ME,
    cc: "",
    messageId: `<${id}@demo>`,
    references: "",
    html: null,
    text: null,
    attachments: [],
    ...m,
  };
}

function thread(
  accountId: string,
  id: string,
  unread: boolean,
  messages: MailMessage[],
): DemoThread {
  const last = messages[messages.length - 1];
  const preview = last.text ?? last.html?.replace(/<[^>]+>/g, " ") ?? "";
  return {
    accountId,
    id,
    subject: messages[0].subject,
    from: last.from,
    snippet: preview.replace(/\s+/g, " ").trim().slice(0, 140),
    date: last.date,
    unread,
    messageCount: messages.length,
    messages,
  };
}

const THREADS: DemoThread[] = [
  thread("deserto", "t-demo-day", true, [
    msg("m1", {
      from: "Maya Patel <maya.patel@dali.dartmouth.edu>",
      subject: "Demo day run of show",
      date: ago(3 * HOUR),
      to: "deserto@dali.dartmouth.edu",
      text: "Hi team,\n\nHere's the plan for Friday:\n\n1. 2:00 setup in the Life Sciences atrium\n2. 2:30 five minute pitch (Jordan)\n3. 2:35 live demo (Alex drives)\n4. 2:45 Q&A\n\nCan everyone confirm by tomorrow?\n\nMaya",
    }),
    msg("m2", {
      from: "Jordan Lee <jordan.lee@dali.dartmouth.edu>",
      subject: "Re: Demo day run of show",
      date: ago(40),
      to: "deserto@dali.dartmouth.edu",
      text: "Works for me. I'll have the pitch deck final by Thursday night. Alex, can you make sure staging has the new onboarding flow?\n\nJordan",
      attachments: ["Deserto pitch v3.pdf"],
    }),
  ]),
  thread("partners", "t-partner-kickoff", true, [
    msg("m3", {
      from: "Rachel Kim <rkim@upvalley-health.org>",
      subject: "Kickoff for the patient intake app",
      date: ago(2 * HOUR),
      to: "partners@dali.dartmouth.edu",
      html: `<div style="font-family:Georgia,serif">
        <p>Hello DALI team,</p>
        <p>Thank you again for taking on our patient intake project this term. We'd love to schedule a <b>kickoff meeting</b> in the next two weeks.</p>
        <p>A few times that work on our end:</p>
        <ul><li>Tuesday 10:00 to 11:00</li><li>Wednesday 2:00 to 3:00</li><li>Friday 9:30 to 10:30</li></ul>
        <p>We'll bring our clinical lead and someone from IT.</p>
        <p style="color:#666">Best,<br>Rachel Kim<br>Director of Operations, Upper Valley Health</p>
      </div>`,
    }),
  ]),
  thread("deserto", "t-figma-review", false, [
    msg("m4", {
      from: "Sam Rivera <sam.rivera@dali.dartmouth.edu>",
      subject: "Figma review notes",
      date: ago(5 * HOUR),
      text: "Left comments on the dashboard frames. Main ones: the empty states need copy, and the table header should stick on scroll. Otherwise looking great!",
    }),
    msg("m5", {
      from: ME,
      subject: "Re: Figma review notes",
      date: ago(4 * HOUR),
      to: "Sam Rivera <sam.rivera@dali.dartmouth.edu>",
      text: "Thanks Sam. Fixed the sticky header, will take a pass at empty states tonight.",
    }),
    msg("m6", {
      from: "Sam Rivera <sam.rivera@dali.dartmouth.edu>",
      subject: "Re: Figma review notes",
      date: ago(3 * HOUR + 20),
      text: "Perfect. Ping me when it's ready and I'll do a final look.",
    }),
  ]),
  thread("partners", "t-invoice", false, [
    msg("m9", {
      from: "Tom Baker <tom@riverbend.coop>",
      subject: "Question about the spring invoice",
      date: ago(1 * DAY + 6 * HOUR),
      to: "partners@dali.dartmouth.edu",
      text: "Hi, our finance team asked whether the spring invoice can be split across two fiscal years. Is that possible?\n\nTom",
    }),
    msg("m10", {
      from: "Priya Shah <priya.shah@dali.dartmouth.edu>",
      subject: "Re: Question about the spring invoice",
      date: ago(1 * DAY + 3 * HOUR),
      to: "Tom Baker <tom@riverbend.coop>",
      text: "Hi Tom, checking with our finance office and will get back to you by Friday.\n\nPriya",
    }),
  ]),
  thread("deserto", "t-api-keys", false, [
    msg("m11", {
      from: "GitHub <noreply@github.com>",
      subject: "[dali-lab/deserto] Dependabot alert: axios",
      date: ago(2 * DAY),
      to: "deserto@dali.dartmouth.edu",
      text: "A moderate severity vulnerability was found in axios < 1.7.4. Upgrade to 1.7.4 or later.",
    }),
  ]),
  thread("partners", "t-thanks", false, [
    msg("m14", {
      from: "Lena Novak <lena@hanovermuseum.org>",
      subject: "Thank you from the museum team",
      date: ago(6 * DAY),
      to: "partners@dali.dartmouth.edu",
      text: "The exhibit kiosk has been a hit with visitors. Thank you all for the incredible work this term!\n\nLena",
    }),
  ]),
];

const COMMENTS: Record<string, { author: string; body: string; minutesAgo: number; mine: boolean }[]> = {
  "partners~t-partner-kickoff": [
    { author: "Priya Shah", body: "Wednesday works best for the Upper Valley team. Can someone confirm with their clinical lead?", minutesAgo: 90, mine: false },
    { author: "Alex Chen", body: "I'll reply and propose Wednesday 2pm.", minutesAgo: 45, mine: true },
  ],
  "partners~t-invoice": [
    { author: "Priya Shah", body: "Finance said yes as long as the PO has two line items. Drafting the reply now.", minutesAgo: 20 * HOUR, mine: false },
  ],
};

const DRAFTS: EmailPageData["drafts"] = [
  {
    id: "demo-draft-kickoff",
    accountId: "partners",
    threadId: "t-partner-kickoff",
    to: "Rachel Kim <rkim@upvalley-health.org>",
    cc: "",
    bcc: "",
    subject: "",
    body: "Hi Rachel,\n\nThanks so much for reaching out! Wednesday 2:00 to 3:00 works well for us. We'll send a calendar invite with a Zoom link shortly.\n\nLooking forward to it,\nThe DALI team",
    shared: true,
    mine: false,
    author: "Priya Shah",
    updatedAt: ago(30),
  },
  {
    id: "demo-draft-new",
    accountId: "deserto",
    threadId: null,
    to: "sam.rivera@dali.dartmouth.edu",
    cc: "",
    bcc: "",
    subject: "Empty state copy",
    body: "Hey Sam, here's a first pass at the empty state copy:\n\n",
    shared: false,
    mine: true,
    author: "Alex Chen",
    updatedAt: ago(2 * HOUR),
  },
];

function matches(t: DemoThread, query: string): boolean {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && w !== "in:inbox" && !w.includes(":"));
  const haystack = [t.subject, t.snippet, ...t.messages.map((m) => `${m.from} ${m.text ?? ""} ${m.html ?? ""}`)]
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function demoEmailPage(request: Request): EmailPageData {
  const url = new URL(request.url);
  const inbox = url.searchParams.get("inbox");
  const view = url.searchParams.get("view") === "drafts" ? "drafts" : "inbox";
  const query = url.searchParams.get("q")?.trim() ?? "";
  const searchAccounts = url.searchParams.get("in")?.split(",").filter(Boolean) ?? [];
  const [selAccount, selThread] = (url.searchParams.get("t") ?? "").split("~");

  const inScope = (accountId: string) =>
    inbox ? accountId === inbox : searchAccounts.length === 0 || searchAccounts.includes(accountId);
  const threads = THREADS.filter((t) => inScope(t.accountId) && t.accountId !== "hiring" && matches(t, query))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(({ messages: _messages, ...summary }) => ({
      ...summary,
      unread: summary.unread && !(summary.accountId === selAccount && summary.id === selThread),
    }));
  const unread: Record<string, number> = {};
  for (const t of THREADS) {
    if (t.unread && t.accountId !== "hiring" && !(t.accountId === selAccount && t.id === selThread)) {
      unread[t.accountId] = (unread[t.accountId] ?? 0) + 1;
    }
  }

  const picked = THREADS.find((t) => t.accountId === selAccount && t.id === selThread);
  const selected: EmailPageData["selected"] = picked
    ? {
        accountId: picked.accountId,
        threadId: picked.id,
        error: false,
        messages: picked.messages,
        comments: (COMMENTS[`${picked.accountId}~${picked.id}`] ?? []).map((c, i) => ({
          id: `demo-comment-${i}`,
          body: c.body,
          createdAt: ago(c.minutesAgo),
          author: { id: `demo-user-${c.author}`, name: c.author, photoUrl: null },
          mine: c.mine,
        })),
      }
    : null;

  return {
    userId: "demo",
    view,
    inbox,
    query,
    ask: url.searchParams.get("ask") ?? "",
    aiEnabled: isAiEnabled(),
    isAdmin: true,
    accounts: ACCOUNTS,
    feed: { threads, errors: inbox && inbox !== "hiring" ? [] : ["hiring"] },
    unread,
    selected,
    drafts: DRAFTS,
    categories: [
      {
        id: "cat-partners",
        name: "Partnerships",
        description: "Partner inquiries and project kickoffs.",
        subscribed: true,
        inboxes: [
          { id: "partners", address: "partners@dali.dartmouth.edu", label: "Partnerships", connected: true, syncError: null },
        ],
      },
      {
        id: "cat-hiring",
        name: "Hiring",
        description: "Applicant questions and interview scheduling.",
        subscribed: true,
        inboxes: [
          { id: "hiring", address: "hiring@dali.dartmouth.edu", label: "Hiring", connected: true, syncError: "Sign-in expired. Reconnect this account." },
        ],
      },
      {
        id: "cat-education",
        name: "Education",
        description: "Course questions and instructor mail.",
        subscribed: false,
        inboxes: [
          { id: "education", address: "education@dali.dartmouth.edu", label: "education@dali.dartmouth.edu", connected: false, syncError: null },
        ],
      },
    ],
  };
}
