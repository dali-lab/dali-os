import { Coffee, FileText } from "lucide-react";
import { useFetcher } from "react-router";
import { useDialog } from "~/components/ui/dialog";

const REQUEST_BUTTONS = {
  CoffeeChat: {
    intent: "coffee-chat",
    icon: Coffee,
    label: "Coffee chat",
    sentLabel: "Coffee chat invite sent",
    title: (name: string) => `Invite ${name} to a coffee chat?`,
    description: (name: string) =>
      `${name} gets an email and a notification that someone wants to grab coffee. They see your name only if they accept.`,
    confirmLabel: "Send invite",
  },
  ResumeReview: {
    intent: "resume-review",
    icon: FileText,
    label: "Resume review",
    sentLabel: "Resume review requested",
    title: (name: string) => `Ask ${name} to review your resume?`,
    description: (name: string) =>
      `${name} gets an email and a notification that someone wants a resume review. They see your name only if they accept.`,
    confirmLabel: "Send request",
  },
} as const;

// Sends an anonymous request. `sent` comes from the loader, so the button stays
// in its sent state on every later visit.
function RequestButton({
  kind,
  firstName,
  sent,
}: {
  kind: keyof typeof REQUEST_BUTTONS;
  firstName: string;
  sent: boolean;
}) {
  const fetcher = useFetcher<{ error?: string } | null>();
  const { confirm } = useDialog();
  const busy = fetcher.state !== "idle";
  const done = sent || busy;
  const copy = REQUEST_BUTTONS[kind];
  const Icon = copy.icon;

  async function send() {
    const ok = await confirm({
      title: copy.title(firstName),
      description: copy.description(firstName),
      confirmLabel: copy.confirmLabel,
    });
    if (ok) fetcher.submit({ intent: copy.intent }, { method: "post" });
  }

  return (
    <div className="mt-1 flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void send()}
        disabled={done}
        className="inline-flex items-center gap-1.5 rounded-full border border-os-container px-3 py-1 text-[12px] font-semibold text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground disabled:pointer-events-none disabled:opacity-70"
      >
        <Icon className="h-3.5 w-3.5" />
        {done ? copy.sentLabel : copy.label}
      </button>
      {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
    </div>
  );
}

export function ProfileRequestButtons({
  isSelf,
  openTo,
  firstName,
  coffeeChatSent,
  resumeReviewSent,
}: {
  isSelf: boolean;
  openTo: { coffeeChats: boolean; resumeReviews: boolean };
  firstName: string;
  coffeeChatSent: boolean;
  resumeReviewSent: boolean;
}) {
  if (isSelf || !(openTo.coffeeChats || openTo.resumeReviews)) return null;
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
      {openTo.coffeeChats && <RequestButton kind="CoffeeChat" firstName={firstName} sent={coffeeChatSent} />}
      {openTo.resumeReviews && <RequestButton kind="ResumeReview" firstName={firstName} sent={resumeReviewSent} />}
    </div>
  );
}
