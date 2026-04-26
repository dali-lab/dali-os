import { useState } from "react";
import { ChevronDown } from "lucide-react";

export function Section({ title, badge, defaultOpen = true, children }: {
  title: string;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-5 py-3 flex items-center justify-between bg-muted/50 hover:bg-muted transition text-left"
      >
        <span className="font-semibold text-foreground text-sm">{title}</span>
        <div className="flex items-center gap-2">
          {badge}
          <ChevronDown className={`w-4 h-4 text-muted-foreground/70 transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </button>
      {open && <div className="p-5 border-t border-border">{children}</div>}
    </div>
  );
}

export function StatPill({ label, value, color = "text-foreground" }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className={`font-semibold ${color}`}>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  ApplicationOpen: "bg-muted text-foreground/80",
  Pending: "bg-blue-100 text-blue-700",
  Rejected: "bg-red-100 text-red-700",
  InvitedToInterview: "bg-purple-100 text-purple-700",
  InterviewScheduled: "bg-indigo-100 text-indigo-700",
  PostInterviewPending: "bg-yellow-100 text-yellow-700",
  Accepted: "bg-green-100 text-green-700",
  Waitlisted: "bg-orange-100 text-orange-700",
};

const STATUS_BADGE_LABELS: Record<string, string> = {
  ApplicationOpen: "Open",
  Pending: "Pending",
  Rejected: "Rejected",
  InvitedToInterview: "Interview Invited",
  InterviewScheduled: "Interview Scheduled",
  PostInterviewPending: "Post-Interview",
  Accepted: "Accepted",
  Waitlisted: "Waitlisted",
};

const DECISION_COLORS: Record<string, string> = {
  Rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  InvitedToInterview: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Accepted: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  Waitlisted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
};

const DECISION_LABELS: Record<string, string> = {
  Rejected: "Reject",
  InvitedToInterview: "Interview",
  Accepted: "Accept",
  Waitlisted: "Waitlist",
};

export function DecisionBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${DECISION_COLORS[type] ?? "bg-muted text-muted-foreground"}`}>
      {DECISION_LABELS[type] ?? type}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${STATUS_BADGE_COLORS[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_BADGE_LABELS[status] ?? status}
    </span>
  );
}
